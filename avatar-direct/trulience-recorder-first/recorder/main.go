// Recorder-first generic-protocol test receiver. Configuration/credentials arrive
// on stdin; stdout is a private JSON event pipe consumed by record-generic.py.
// No warmup discard, media retiming, or mouth-based alignment occurs here.
package main

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	rtc "github.com/AgoraIO-Extensions/Agora-Golang-Server-SDK/v2/go_sdk/rtc"
	token "github.com/AgoraIO/Tools/DynamicKey/AgoraDynamicKey/go/src/rtctokenbuilder2"
)

type config struct {
	AppID         string `json:"appId"`
	Certificate   string `json:"certificate"`
	Channel       string `json:"channel"`
	PublisherUID  string `json:"publisherUid"`
	SubscriberUID string `json:"subscriberUid"`
	Directory     string `json:"directory"`
}

func checked(code int, operation string) error {
	if code != 0 {
		return fmt.Errorf("%s failed (%d)", operation, code)
	}
	return nil
}

func wavHeader(f *os.File, size uint32) error {
	b := make([]byte, 44)
	copy(b, "RIFF")
	binary.LittleEndian.PutUint32(b[4:], 36+size)
	copy(b[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(b[16:], 16)
	binary.LittleEndian.PutUint16(b[20:], 1)
	binary.LittleEndian.PutUint16(b[22:], 1)
	binary.LittleEndian.PutUint32(b[24:], 16000)
	binary.LittleEndian.PutUint32(b[28:], 32000)
	binary.LittleEndian.PutUint16(b[32:], 2)
	binary.LittleEndian.PutUint16(b[34:], 16)
	copy(b[36:], "data")
	binary.LittleEndian.PutUint32(b[40:], size)
	_, err := f.WriteAt(b, 0)
	return err
}

func run() error {
	var cfg config
	if err := json.NewDecoder(io.LimitReader(os.Stdin, 16384)).Decode(&cfg); err != nil {
		return errors.New("invalid private configuration")
	}
	pubID, e1 := strconv.ParseUint(cfg.PublisherUID, 10, 32)
	subID, e2 := strconv.ParseUint(cfg.SubscriberUID, 10, 32)
	if e1 != nil || e2 != nil || pubID == 0 || subID == 0 || pubID == subID ||
		cfg.AppID == "" || cfg.Channel == "" || !filepath.IsAbs(cfg.Directory) {
		return errors.New("invalid recorder identities/directory")
	}
	mint := func(uid uint32) (string, error) {
		if cfg.Certificate == "" {
			return "", nil
		}
		return token.BuildTokenWithUid(cfg.AppID, cfg.Certificate, cfg.Channel, uid, token.RolePublisher, 600, 600)
	}
	pubToken, err := mint(uint32(pubID))
	if err != nil {
		return errors.New("publisher token generation failed")
	}
	subToken, err := mint(uint32(subID))
	if err != nil {
		return errors.New("subscriber token generation failed")
	}
	var files []*os.File
	defer func() {
		for _, f := range files {
			f.Close()
		}
	}()
	open := func(name string) (*os.File, error) {
		f, err := os.OpenFile(filepath.Join(cfg.Directory, name), os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
		if err == nil {
			files = append(files, f)
		}
		return f, err
	}
	video, err := open("recv.264")
	if err != nil {
		return err
	}
	audio, err := open("audio.wav")
	if err != nil {
		return err
	}
	if err = wavHeader(audio, 0); err != nil {
		return err
	}
	if _, err = audio.Seek(44, 0); err != nil {
		return err
	}
	vt, err := open("video.timestamps")
	if err != nil {
		return err
	}
	if _, err = fmt.Fprintln(vt, "# timestamp format v2"); err != nil {
		return err
	}
	vj, err := open("video.jsonl")
	if err != nil {
		return err
	}
	aj, err := open("audio.jsonl")
	if err != nil {
		return err
	}
	vlog, alog := json.NewEncoder(vj), json.NewEncoder(aj)

	svc := rtc.NewAgoraServiceConfig()
	svc.AppId, svc.EnableVideo = cfg.AppID, true
	svc.UseStringUid = false
	svc.LogPath = filepath.Join(cfg.Directory, "agora.log")
	svc.ConfigDir, svc.DataDir = cfg.Directory, cfg.Directory
	if err = checked(rtc.Initialize(svc), "SDK initialize"); err != nil {
		return err
	}
	defer rtc.Release()
	// Match the shared generic recorder's audio scenario. Its SDK needs a local
	// PCM track for the AI QoS capability callback even though we send no audio.
	pub := rtc.NewRtcConPublishConfig()
	pub.AudioScenario = rtc.AudioScenarioAiServer
	pub.IsPublishAudio, pub.IsPublishVideo = true, true
	pub.AudioPublishType = rtc.AudioPublishTypePcm
	pub.VideoPublishType = rtc.VideoPublishTypeNoPublish
	con := rtc.NewRtcConnection(&rtc.RtcConnectionConfig{
		AutoSubscribeAudio: true, AutoSubscribeVideo: true,
		ClientRole: rtc.ClientRoleBroadcaster, ChannelProfile: rtc.ChannelProfileLiveBroadcasting,
	}, pub)
	if con == nil {
		return errors.New("create receiver failed")
	}
	var mu sync.Mutex
	var audioBytes, videoBytes int64
	var frames int
	var videoStart, audioStart time.Time
	var videoCapture0 int64
	var firstKeyframe bool
	released := false
	fail := make(chan error, 1)
	report := func(err error) {
		if err != nil {
			select {
			case fail <- err:
			default:
			}
		}
	}
	// Stop all callbacks before finalizing WAV/metadata and closing files.
	defer func() {
		if !released {
			con.Disconnect()
			con.Release()
		}
		mu.Lock()
		defer mu.Unlock()
		if err := wavHeader(audio, uint32(audioBytes)); err != nil {
			report(err)
		}
	}()
	connected := make(chan struct{}, 1)
	observer := &rtc.RtcConnectionObserver{
		OnConnected: func(*rtc.RtcConnection, *rtc.RtcConnectionInfo, int) {
			select {
			case connected <- struct{}{}:
			default:
			}
		},
		OnConnectionFailure: func(_ *rtc.RtcConnection, _ *rtc.RtcConnectionInfo, code int) {
			report(fmt.Errorf("RTC connection failed (%d)", code))
		},
		OnConnectionLost:         func(*rtc.RtcConnection, *rtc.RtcConnectionInfo) { report(errors.New("RTC connection lost")) },
		OnAIQoSCapabilityMissing: func(*rtc.RtcConnection, int) int { return int(rtc.AudioScenarioDefault) },
	}
	if err = checked(con.RegisterObserver(observer), "connection observer"); err != nil {
		return err
	}
	videoObserver := &rtc.VideoEncodedFrameObserver{
		OnEncodedVideoFrame: func(channel, uid string, buf []byte, fi *rtc.EncodedVideoFrameInfo) bool {
			if channel != cfg.Channel || uid != cfg.PublisherUID {
				return true
			}
			now := time.Now()
			mu.Lock()
			defer mu.Unlock()
			if videoBytes+int64(len(buf)) > 128*1024*1024 {
				report(errors.New("video capture limit"))
				return false
			}
			if videoStart.IsZero() {
				videoStart, videoCapture0 = now, fi.CaptureTimeMs
				firstKeyframe = fi.FrameType == rtc.VideoFrameTypeKeyFrame
			}
			clock := now.Sub(videoStart).Milliseconds()
			if videoCapture0 > 0 && fi.CaptureTimeMs > 0 {
				clock = fi.CaptureTimeMs - videoCapture0
			}
			n, e := video.Write(buf)
			report(e)
			if n != len(buf) {
				report(io.ErrShortWrite)
			}
			_, e = fmt.Fprintln(vt, clock)
			report(e)
			report(vlog.Encode(map[string]any{
				"index": frames, "arrivalMs": now.UnixMilli(), "elapsedMs": now.Sub(videoStart).Milliseconds(),
				"captureMs": fi.CaptureTimeMs, "ptsMs": clock, "bytes": len(buf), "byteOffset": videoBytes,
				"keyframe": fi.FrameType == rtc.VideoFrameTypeKeyFrame,
			}))
			frames++
			videoBytes += int64(n)
			return true
		},
	}
	if err = checked(con.RegisterVideoEncodedFrameObserver(videoObserver), "video observer"); err != nil {
		return err
	}
	audioObserver := &rtc.AudioFrameObserver{
		OnGetAudioFramePosition: func(*rtc.LocalUser) int { return 0x0008 },
		OnPlaybackAudioFrameBeforeMixing: func(_ *rtc.LocalUser, channel, uid string, f *rtc.AudioFrame, _ rtc.VadState, _ *rtc.AudioFrame) bool {
			// This connection owns one channel. Some SDK versions supply an empty
			// channel argument here; select the requested publisher by UID.
			if uid != cfg.PublisherUID {
				return true
			}
			now := time.Now()
			mu.Lock()
			defer mu.Unlock()
			if f.SamplesPerSec != 16000 || f.Channels != 1 || len(f.Buffer)%2 != 0 {
				report(errors.New("unexpected PCM format"))
				return false
			}
			if audioBytes+int64(len(f.Buffer)) > 8*1024*1024 {
				report(errors.New("audio capture limit"))
				return false
			}
			if audioStart.IsZero() {
				audioStart = now
			}
			n, e := audio.Write(f.Buffer)
			report(e)
			if n != len(f.Buffer) {
				report(io.ErrShortWrite)
			}
			report(alog.Encode(map[string]any{
				"arrivalMs": now.UnixMilli(), "elapsedMs": now.Sub(audioStart).Milliseconds(),
				"renderMs": f.RenderTimeMs, "presentMs": f.PresentTimeMs,
				"byteOffset": audioBytes, "bytes": len(f.Buffer), "sampleRate": f.SamplesPerSec,
			}))
			audioBytes += int64(n)
			return true
		},
	}
	if err = checked(con.Connect(subToken, cfg.Channel, cfg.SubscriberUID, ""), "RTC connect"); err != nil {
		return err
	}
	select {
	case <-connected:
	case err = <-fail:
		return err
	case <-time.After(30 * time.Second):
		return errors.New("recorder join timeout")
	}
	if err = checked(con.GetLocalUser().SetPlaybackAudioFrameBeforeMixingParameters(1, 16000), "PCM format"); err != nil {
		return err
	}
	if err = checked(con.RegisterAudioFrameObserver(audioObserver, 0, nil), "audio observer"); err != nil {
		return err
	}
	// Only this event releases the driver's POST Start. Credentials stay in its
	// private pipe; the driver excludes publisherToken from the saved event log.
	if err = json.NewEncoder(os.Stdout).Encode(map[string]any{
		"event": "ready", "epochMs": time.Now().UnixMilli(), "publisherToken": pubToken,
	}); err != nil {
		return err
	}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(stop)
	select {
	case <-stop:
	case err = <-fail:
		return err
	case <-time.After(180 * time.Second):
		return errors.New("recorder lifetime limit")
	}
	// Disconnect now, ensuring no further writes race the finalized metadata.
	con.Disconnect()
	con.Release()
	released = true
	mu.Lock()
	defer mu.Unlock()
	select {
	case err = <-fail:
		return err
	default:
	}
	if frames == 0 || audioBytes == 0 {
		return errors.New("missing recorded video/audio")
	}
	if !firstKeyframe {
		return errors.New("first video frame was not a keyframe; capture preserved for diagnosis")
	}
	if err = wavHeader(audio, uint32(audioBytes)); err != nil {
		return err
	}
	meta := map[string]any{
		"frames": frames, "audioBytes": audioBytes, "videoBytes": videoBytes,
		"audio_offset_ms":        audioStart.Sub(videoStart).Milliseconds(),
		"first_video_arrival_ms": videoStart.UnixMilli(), "first_audio_arrival_ms": audioStart.UnixMilli(),
		"video_capture0_ms": videoCapture0, "first_keyframe": firstKeyframe,
		"audio_clock": "sample-count", "track_origin": "first-callback-arrival",
		"discarded_audio_bytes": 0, "discarded_video_frames": 0,
	}
	data, _ := json.MarshalIndent(meta, "", "  ")
	if err = os.WriteFile(filepath.Join(cfg.Directory, "meta.json"), data, 0600); err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(cfg.Directory, "meta.txt"),
		[]byte(fmt.Sprintf("audio_offset_ms=%d\nframes=%d\n", audioStart.Sub(videoStart).Milliseconds(), frames)), 0600); err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"event": "complete", "frames": frames, "audioBytes": audioBytes})
}

func main() {
	syscall.Umask(0077)
	if err := run(); err != nil {
		// Errors contain operation/status information, never supplied tokens.
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
