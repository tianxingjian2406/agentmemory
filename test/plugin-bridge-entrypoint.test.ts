import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPluginBridge } from "../src/mcp/plugin-bridge.js";
import { getAllTools } from "../src/mcp/tools-registry.js";

describe("bundled MCP bridge entrypoint", () => {
  it("answers initialize when the plugin directory is reached through a symlink", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "agentmemory-linked-plugin-"));
    try {
      const linked = join(sandbox, "plugin link");
      symlinkSync(resolve(__dirname, "../plugin"), linked, "junction");
      const output = execFileSync(process.execPath, [join(linked, "scripts/plugin-bridge.mjs")], {
        input: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } }) + "\n",
        encoding: "utf8",
        timeout: 5000,
        env: { ...process.env, AGENTMEMORY_URL: "http://127.0.0.1:1", AGENTMEMORY_SECRET: "" },
      });
      expect(JSON.parse(output)).toMatchObject({ id: 1, result: { serverInfo: { name: "agentmemory" } } });
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it("forwards parameter schemas through tools/list", async () => {
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env["AGENTMEMORY_URL"];
    const originalCredentialMode = process.env["AGENTMEMORY_CREDENTIAL_MODE"];
    const tools = getAllTools();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ tools }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    process.env["AGENTMEMORY_URL"] = "http://127.0.0.1:3111";
    process.env["AGENTMEMORY_CREDENTIAL_MODE"] = "explicit";
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const result = await createPluginBridge()("tools/list", {});
      expect(result).toEqual({ tools });
      for (const tool of tools.filter((tool) => tool.name !== "memory_slot_list")) {
        expect(tool.inputSchema).toMatchObject({
          type: "object",
          properties: expect.any(Object),
        });
        expect(Object.keys(tool.inputSchema.properties).length).toBeGreaterThan(0);
      }
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUrl === undefined) delete process.env["AGENTMEMORY_URL"];
      else process.env["AGENTMEMORY_URL"] = originalUrl;
      if (originalCredentialMode === undefined) delete process.env["AGENTMEMORY_CREDENTIAL_MODE"];
      else process.env["AGENTMEMORY_CREDENTIAL_MODE"] = originalCredentialMode;
    }
  });
});
