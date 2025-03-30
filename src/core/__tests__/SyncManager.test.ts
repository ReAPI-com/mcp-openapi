import fs from "fs/promises";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncManager } from "../SyncManager";
import { SyncConfig } from "../interfaces/ISyncManager";

describe("SyncManager", () => {
  const TEST_TARGET_DIR = path.join(__dirname, "../../test-temp");
  let syncManager: SyncManager;

  beforeEach(async () => {
    syncManager = new SyncManager(TEST_TARGET_DIR);
    await fs.mkdir(TEST_TARGET_DIR, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(TEST_TARGET_DIR, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it("should sync files from both URL and file sources", async () => {
    const config: SyncConfig = {
      targetDirectory: TEST_TARGET_DIR,
      sources: [
        {
          type: "url",
          url: "https://raw.githubusercontent.com/OpenAPITools/openapi-petstore/refs/heads/master/src/main/resources/openapi.yaml",
          specId: "petstore"
        },
        {
          type: "file",
          path: path.join(
            __dirname,
            "../../../test/sync-source/basic-api-1.json"
          ),
          specId: "basic-api"
        },
      ],
    };

    const results = await syncManager.sync(config);

    // Check results
    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[0].filename).toBe("petstore.yaml");
    expect(results[1].success).toBe(true);
    expect(results[1].filename).toBe("basic-api.json");

    // Verify files exist
    const files = await fs.readdir(TEST_TARGET_DIR);
    expect(files).toContain("petstore.yaml");
    expect(files).toContain("basic-api.json");

    // Verify file contents
    const yamlContent = await fs.readFile(
      path.join(TEST_TARGET_DIR, "petstore.yaml"),
      "utf-8"
    );
    expect(yamlContent).toContain("openapi: 3.0.0");
    expect(yamlContent).toContain("OpenAPI Petstore");

    const jsonContent = await fs.readFile(
      path.join(TEST_TARGET_DIR, "basic-api.json"),
      "utf-8"
    );
    expect(JSON.parse(jsonContent)).toBeDefined();
  });

  it("should handle missing environment variables", async () => {
    const config: SyncConfig = {
      targetDirectory: TEST_TARGET_DIR,
      sources: [
        {
          type: "url",
          url: "https://raw.githubusercontent.com/OpenAPITools/openapi-petstore/refs/heads/master/src/main/resources/openapi.yaml",
          specId: "petstore-auth",
          auth: {
            type: "bearer",
            value: "{{MISSING_TOKEN}}",
          },
        },
      ],
    };

    const results = await syncManager.sync(config);
    expect(results[0].success).toBe(false);
    expect(results[0].error?.message).toContain(
      "Environment variable MISSING_TOKEN not found"
    );
    expect(results[0].filename).toBe("petstore-auth.yaml");
  });

  it("should handle non-existent file sources", async () => {
    const config: SyncConfig = {
      targetDirectory: TEST_TARGET_DIR,
      sources: [
        {
          type: "file",
          path: path.join(__dirname, "non-existent.json"),
          specId: "non-existent"
        },
      ],
    };

    const results = await syncManager.sync(config);
    expect(results[0].success).toBe(false);
    expect(results[0].error?.message).toContain("ENOENT");
    expect(results[0].filename).toBe("non-existent.json");
  });

  it("should handle invalid URLs", async () => {
    const config: SyncConfig = {
      targetDirectory: TEST_TARGET_DIR,
      sources: [
        {
          type: "url",
          url: "https://invalid-url-that-does-not-exist.com/spec.yaml",
          specId: "invalid-spec"
        },
      ],
    };

    const results = await syncManager.sync(config);
    expect(results[0].success).toBe(false);
    expect(results[0].filename).toBe("invalid-spec.yaml");
  });

  it("should detect duplicate specIds", async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    const config: SyncConfig = {
      targetDirectory: TEST_TARGET_DIR,
      sources: [
        {
          type: "url",
          url: "https://api1.example.com/spec.yaml",
          specId: "duplicate"
        },
        {
          type: "file",
          path: path.join(__dirname, "spec.json"),
          specId: "duplicate"
        },
      ],
    };

    const results = await syncManager.sync(config);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Duplicate specId found: duplicate")
    );
    
    consoleSpy.mockRestore();
  });

  describe("prepareRequest", () => {
    const TEST_URL = "https://api.example.com/spec.yaml";

    it("should return empty headers and original URL when no auth provided", () => {
      const { headers, url } = syncManager.prepareRequest(TEST_URL);
      expect(headers).toEqual({});
      expect(url).toBe(TEST_URL);
    });

    it("should generate bearer token header", () => {
      const { headers, url } = syncManager.prepareRequest(TEST_URL, {
        type: "bearer",
        value: "my-token",
      });
      expect(headers).toEqual({
        Authorization: "Bearer my-token",
      });
      expect(url).toBe(TEST_URL);
    });

    it("should generate basic auth header", () => {
      const { headers, url } = syncManager.prepareRequest(TEST_URL, {
        type: "basic",
        value: {
          username: "user123",
          password: "pass456",
        },
      });
      // Base64 of "user123:pass456"
      expect(headers).toEqual({
        Authorization: "Basic dXNlcjEyMzpwYXNzNDU2",
      });
      expect(url).toBe(TEST_URL);
    });

    it("should add custom auth as header by default", () => {
      const { headers, url } = syncManager.prepareRequest(TEST_URL, {
        type: "custom",
        value: {
          name: "X-API-Key",
          value: "custom-key",
        },
      });
      expect(headers).toEqual({
        "X-API-Key": "custom-key",
      });
      expect(url).toBe(TEST_URL);
    });

    it("should add custom auth as query parameter when position is query", () => {
      const { headers, url } = syncManager.prepareRequest(TEST_URL, {
        type: "custom",
        position: "query",
        value: {
          name: "api_key",
          value: "custom-key",
        },
      });
      expect(headers).toEqual({});
      expect(url).toBe("https://api.example.com/spec.yaml?api_key=custom-key");
    });

    it("should resolve environment variables in bearer token", () => {
      process.env.TEST_TOKEN = "env-token";
      const { headers, url } = syncManager.prepareRequest(TEST_URL, {
        type: "bearer",
        value: "{{TEST_TOKEN}}",
      });
      expect(headers).toEqual({
        Authorization: "Bearer env-token",
      });
      expect(url).toBe(TEST_URL);
      delete process.env.TEST_TOKEN;
    });

    it("should resolve environment variables in basic auth", () => {
      process.env.TEST_USER = "env-user";
      process.env.TEST_PASS = "env-pass";
      const { headers, url } = syncManager.prepareRequest(TEST_URL, {
        type: "basic",
        value: {
          username: "{{TEST_USER}}",
          password: "{{TEST_PASS}}",
        },
      });
      expect(headers).toEqual({
        Authorization: "Basic ZW52LXVzZXI6ZW52LXBhc3M=",
      });
      expect(url).toBe(TEST_URL);
      delete process.env.TEST_USER;
      delete process.env.TEST_PASS;
    });

    it("should resolve environment variables in custom header", () => {
      process.env.API_KEY = "env-api-key";
      const { headers, url } = syncManager.prepareRequest(TEST_URL, {
        type: "custom",
        value: {
          name: "X-API-Key",
          value: "{{API_KEY}}",
        },
      });
      expect(headers).toEqual({
        "X-API-Key": "env-api-key",
      });
      expect(url).toBe(TEST_URL);
      delete process.env.API_KEY;
    });

    it("should resolve environment variables in custom query param", () => {
      process.env.API_KEY = "env-api-key";
      const { headers, url } = syncManager.prepareRequest(TEST_URL, {
        type: "custom",
        position: "query",
        value: {
          name: "api_key",
          value: "{{API_KEY}}",
        },
      });
      expect(headers).toEqual({});
      expect(url).toBe("https://api.example.com/spec.yaml?api_key=env-api-key");
      delete process.env.API_KEY;
    });

    it("should throw error for missing environment variable", () => {
      expect(() =>
        syncManager.prepareRequest(TEST_URL, {
          type: "bearer",
          value: "{{MISSING_VAR}}",
        })
      ).toThrow("Environment variable MISSING_VAR not found");
    });

    it("should handle URLs with existing query parameters", () => {
      const urlWithQuery = "https://api.example.com/spec.yaml?version=1";
      const { headers, url } = syncManager.prepareRequest(urlWithQuery, {
        type: "custom",
        position: "query",
        value: {
          name: "api_key",
          value: "custom-key",
        },
      });
      expect(headers).toEqual({});
      expect(url).toBe("https://api.example.com/spec.yaml?version=1&api_key=custom-key");
    });
  });
});
