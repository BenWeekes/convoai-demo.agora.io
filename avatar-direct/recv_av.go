package main

// Combined A/V subscriber recorder: one connection captures the remote encoded
// H.264 video (-> recv.264) AND per-user PCM audio (-> audio.wav, 16k mono).
// Usage: recv_av <appid> <channel> [videoUid]
//   videoUid: only record video from this uid (e.g. 102, the avatar). "" = any.
import (
	"encoding/binary"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"time"

	agoraservice "github.com/AgoraIO-Extensions/Agora-Golang-Server-SDK/v2/go_sdk/rtc"
	rtctokenbuilder "github.com/AgoraIO/Tools/DynamicKey/AgoraDynamicKey/go/src/rtctokenbuilder2"
)

type WavWriter struct {
	file        *os.File
	dataSize    uint32
	sampleRate  uint32
	numChannels uint16
	bits        uint16
	mu          sync.Mutex
}

func NewWavWriter(fn string, sr uint32, ch uint16, bits uint16) *WavWriter {
	f, _ := os.Create(fn)
	w := &WavWriter{file: f, sampleRate: sr, numChannels: ch, bits: bits}
	w.header()
	return w
}
func (w *WavWriter) header() {
	w.file.Write([]byte("RIFF"))
	binary.Write(w.file, binary.LittleEndian, uint32(36+w.dataSize))
	w.file.Write([]byte("WAVE"))
	w.file.Write([]byte("fmt "))
	binary.Write(w.file, binary.LittleEndian, uint32(16))
	binary.Write(w.file, binary.LittleEndian, uint16(1))
	binary.Write(w.file, binary.LittleEndian, w.numChannels)
	binary.Write(w.file, binary.LittleEndian, w.sampleRate)
	binary.Write(w.file, binary.LittleEndian, w.sampleRate*uint32(w.numChannels*w.bits/8))
	binary.Write(w.file, binary.LittleEndian, w.numChannels*w.bits/8)
	binary.Write(w.file, binary.LittleEndian, w.bits)
	w.file.Write([]byte("data"))
	binary.Write(w.file, binary.LittleEndian, w.dataSize)
}
func (w *WavWriter) Write(b []byte) {
	w.mu.Lock()
	n, _ := w.file.Write(b)
	w.dataSize += uint32(n)
	w.mu.Unlock()
}
func (w *WavWriter) Close() {
	w.file.Seek(0, 0)
	w.header()
	w.file.Close()
}

func main() {
	argus := os.Args
	if len(argus) < 3 {
		fmt.Println("usage: recv_av <appid> <channel> [videoUid]")
		return
	}
	appid, channel := argus[1], argus[2]
	wantUid := ""
	if len(argus) >= 4 {
		wantUid = argus[3]
	}
	cert := os.Getenv("AGORA_APP_CERTIFICATE")
	userId := "0"
	token := ""
	if cert != "" {
		var err error
		token, err = rtctokenbuilder.BuildTokenWithUserAccount(appid, cert, channel, userId,
			rtctokenbuilder.RolePublisher, 3600, 3600)
		if err != nil {
			fmt.Println("token err:", err)
			return
		}
	}

	svc := agoraservice.NewAgoraServiceConfig()
	svc.EnableVideo = true
	svc.AppId = appid
	agoraservice.Initialize(svc)
	defer agoraservice.Release()

	vfile, _ := os.OpenFile("./recv.264", os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	defer vfile.Close()
	var vmu sync.Mutex
	wav := NewWavWriter("./audio.wav", 16000, 1, 16)
	defer wav.Close()
	// Per-frame wall-clock timestamps (mkvmerge v2 format) so the reconstructed
	// video keeps LemonSlice's true realtime cadence even when frames are dropped;
	// audioOffsetMs aligns the audio start to the first video frame.
	tsfile, _ := os.OpenFile("./video.timestamps", os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	defer tsfile.Close()
	tsfile.WriteString("# timestamp format v2\n")
	var t0 time.Time
	var t0set, audioSet bool
	var audioT0 time.Time
	var tmu sync.Mutex
	nframe := 0
	// Media clocks (for TRUE A/V sync, not wall-clock arrival):
	var vCap0 int64 = -1  // first video CaptureTimeMs
	var aRender0 int64 = -1 // first audio RenderTimeMs
	var aPresent0 int64 = -1

	conSignal := make(chan struct{})
	srcUid := ""
	conHandler := &agoraservice.RtcConnectionObserver{
		OnConnected: func(c *agoraservice.RtcConnection, i *agoraservice.RtcConnectionInfo, r int) {
			fmt.Println("connected"); conSignal <- struct{}{}
		},
		OnUserJoined:  func(c *agoraservice.RtcConnection, uid string) { fmt.Println("join", uid) },
		OnUserLeft:    func(c *agoraservice.RtcConnection, uid string, r int) {},
		OnAIQoSCapabilityMissing: func(c *agoraservice.RtcConnection, d int) int { return int(agoraservice.AudioScenarioDefault) },
	}

	videoObs := &agoraservice.VideoEncodedFrameObserver{
		OnEncodedVideoFrame: func(uid string, buf []byte, fi *agoraservice.EncodedVideoFrameInfo) bool {
			if wantUid != "" && uid != wantUid {
				return true
			}
			srcUid = uid
			now := time.Now()
			tmu.Lock()
			if !t0set {
				t0 = now
				t0set = true
			}
			ms := now.Sub(t0).Milliseconds()
			tmu.Unlock()
			vmu.Lock()
			if vCap0 < 0 && fi.CaptureTimeMs > 0 {
				vCap0 = fi.CaptureTimeMs
			}
			vfile.Write(buf)
			// Prefer the media capture clock; fall back to wall-clock if unset.
			tsMs := ms
			if vCap0 > 0 && fi.CaptureTimeMs > 0 {
				tsMs = fi.CaptureTimeMs - vCap0
			}
			fmt.Fprintf(tsfile, "%d\n", tsMs)
			if nframe < 5 {
				fmt.Printf("vframe %d wall=%dms capture=%dms fps=%d\n",
					nframe, ms, fi.CaptureTimeMs, fi.FramesPerSecond)
			}
			nframe++
			vmu.Unlock()
			return true
		},
	}
	seenAudioUid := map[string]bool{}
	audioObs := &agoraservice.AudioFrameObserver{
		OnPlaybackAudioFrameBeforeMixing: func(lu *agoraservice.LocalUser, chId string, uid string, f *agoraservice.AudioFrame, vs agoraservice.VadState, vf *agoraservice.AudioFrame) bool {
			if !seenAudioUid[uid] {
				seenAudioUid[uid] = true
				fmt.Printf("audio uid=%s render=%dms present=%dms sr=%d\n", uid, f.RenderTimeMs, f.PresentTimeMs, f.SamplesPerSec)
			}
			// Only record the AVATAR's republished audio (uid = wantUid, e.g. 102),
			// which is already A/V-synced. The agent's raw TTS (other uid) leads the
			// avatar video by the render latency and would desync if mixed in.
			if wantUid != "" && uid != wantUid {
				return true
			}
			// Record audio from its first frame. Both audio and video streams from this
			// uid begin with the same content (word 1) — the arrival gap is just network
			// delay — so downstream we mux both from frame 0 with NO offset.
			tmu.Lock()
			if !audioSet {
				audioT0 = time.Now()
				audioSet = true
				aRender0 = f.RenderTimeMs
				aPresent0 = f.PresentTimeMs
			}
			tmu.Unlock()
			wav.Write(f.Buffer)
			return true
		},
	}

	conCfg := &agoraservice.RtcConnectionConfig{
		AutoSubscribeAudio: true, AutoSubscribeVideo: true,
		ClientRole: agoraservice.ClientRoleBroadcaster, ChannelProfile: agoraservice.ChannelProfileLiveBroadcasting,
	}
	// NB: create a local PCM audio track (IsPublishAudio + AudioPublishTypePcm),
	// matching recv_h264. Otherwise the SDK's OnCapabilitiesChanged handler (which
	// LemonSlice triggers) calls Release on a nil LocalAudioTrack and segfaults.
	pub := agoraservice.NewRtcConPublishConfig()
	pub.AudioScenario = agoraservice.AudioScenarioAiServer
	pub.IsPublishAudio = true
	pub.IsPublishVideo = true
	pub.AudioProfile = agoraservice.AudioProfileDefault
	pub.AudioPublishType = agoraservice.AudioPublishTypePcm
	pub.VideoPublishType = agoraservice.VideoPublishTypeNoPublish

	con := agoraservice.NewRtcConnection(conCfg, pub)
	con.RegisterObserver(conHandler)
	con.RegisterVideoEncodedFrameObserver(videoObs)
	con.Connect(token, channel, userId)
	<-conSignal
	con.GetLocalUser().SetPlaybackAudioFrameBeforeMixingParameters(1, 16000)
	con.RegisterAudioFrameObserver(audioObs, 0, nil)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	lastIntra := time.Now().UnixMilli()
	ticker := time.NewTicker(200 * time.Millisecond)
	for {
		select {
		case <-stop:
			fmt.Println("stopping")
			off := int64(0)
			tmu.Lock()
			if t0set && audioSet {
				off = audioT0.Sub(t0).Milliseconds()
			}
			tmu.Unlock()
			mediaOff := int64(0)
			haveMedia := 0
			if vCap0 > 0 && aRender0 > 0 {
				mediaOff = aRender0 - vCap0
				haveMedia = 1
			}
			os.WriteFile("./meta.txt", []byte(fmt.Sprintf(
				"audio_offset_ms=%d\nframes=%d\nvideo_capture0_ms=%d\naudio_render0_ms=%d\naudio_present0_ms=%d\nmedia_offset_ms=%d\nhave_media_clock=%d\n",
				off, nframe, vCap0, aRender0, aPresent0, mediaOff, haveMedia)), 0644)
			con.Disconnect(); con.Release()
			return
		case <-ticker.C:
			now := time.Now().UnixMilli()
			if srcUid != "" && now-lastIntra > 1000 {
				con.SendIntraRequest(srcUid)
				lastIntra = now
			}
		}
	}
}
