// Local smoke test: drive the baccarat MCP server like ConvoAI would.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const channel = process.argv[2] || "smoke_test_chan";
const url = `http://127.0.0.1:8117/mcp/${channel}`;
const transport = new StreamableHTTPClientTransport(new URL(url));
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const bal0 = await client.callTool({ name: "get_balance", arguments: {} });
console.log("start:", bal0.content[0].text);

for (const [side, amt] of [["player", 10], ["banker", 25], ["tie", 5]]) {
  const r = await client.callTool({ name: "deal_hand", arguments: { bet_side: side, bet_amount: amt } });
  const o = JSON.parse(r.content[0].text);
  if (o.param) {
    console.log(`bet ${amt} on ${side}: param="${o.param}" | P${o.player_total} B${o.banker_total} `
      + `win=${o.winner} you=${o.user_won ? "WON" : (o.net === 0 ? "PUSH" : "lost")} (${o.net}) bal=${o.balance}`);
    console.log(`   deal_tag: ${o.deal_tag}`);
  } else {
    console.log(`bet ${amt} on ${side}: ${o ?? r.content[0].text}`);
  }
}
await client.close();
