import fs from "fs/promises";
import { OpenAPIV3 } from "openapi-types";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SpecCatalogEntry,
  SpecServiceConfig,
} from "../interfaces/ISpecService";
import { ConsoleLogger } from "../Logger";
import { DefaultSpecProcessor } from "../SpecProcessor";
import { DefaultSpecScanner } from "../SpecScanner";
import { FileSystemSpecService, SpecServiceError } from "../SpecService";

describe("FileSystemSpecService", () => {
  const testDataDir = "test/data";
  const catalogDir = path.join(testDataDir, "_catalog");
  const dereferencedDir = path.join(testDataDir, "_dereferenced");
  let service: FileSystemSpecService;

  const createTestConfig = (basePath: string): SpecServiceConfig => ({
    basePath,
    catalogDir: "_catalog",
    dereferencedDir: "_dereferenced",
    cache: {
      maxSize: 100,
      ttl: 1000 * 60 * 5, // 5 minutes for tests
    },
  });

  beforeEach(async () => {
    // Clean up and create test directories
    await fs.rm(catalogDir, { recursive: true, force: true });
    await fs.rm(dereferencedDir, { recursive: true, force: true });
    await fs.mkdir(catalogDir, { recursive: true });
    await fs.mkdir(dereferencedDir, { recursive: true });

    const scanner = new DefaultSpecScanner(new DefaultSpecProcessor());
    const config = createTestConfig(testDataDir);
    const logger = new ConsoleLogger();

    service = new FileSystemSpecService(scanner, config, logger);
    await service.initialize();
  });

  afterEach(async () => {
    // Clean up test directories
    await fs.rm(catalogDir, { recursive: true, force: true });
    await fs.rm(dereferencedDir, { recursive: true, force: true });
  });

  describe("scanAndPersist", () => {
    it("should scan and persist OpenAPI specs from test data directory", async () => {
      // Act
      await service.scanAndSave(testDataDir);

      // Assert
      const catalog = await service.loadSpecCatalog();
      expect(catalog.length).toBeGreaterThan(0);

      // Check if specs were persisted
      const petstore = await service.loadSpec("petstore");
      expect(petstore).toBeDefined();
      expect(petstore.info.title).toBe("Pet Store API");

      // Verify Pet schema structure
      const petSchema = petstore.components?.schemas
        ?.Pet as OpenAPIV3.SchemaObject;
      expect(petSchema).toBeDefined();
      expect(petSchema.type).toBe("object");
      expect(petSchema.properties).toBeDefined();

      // Verify inherited properties from Animal
      expect(petSchema.properties?.id).toBeDefined();
      expect(petSchema.properties?.name).toBeDefined();
      expect(petSchema.properties?.birthDate).toBeDefined();

      // Verify Pet-specific properties
      expect(petSchema.properties?.breed).toBeDefined();
      expect(petSchema.properties?.category).toBeDefined();
      expect(petSchema.properties?.ownerId).toBeDefined();

      // Verify required fields
      expect(petSchema.required).toBeDefined();
      expect(petSchema.required).toContain("id");
      expect(petSchema.required).toContain("name");
      expect(petSchema.required).toContain("category");
    });

    it("should handle errors during scanning gracefully", async () => {
      // Arrange
      const invalidSpecPath = path.join(testDataDir, "invalid.yaml");
      await fs.writeFile(invalidSpecPath, "invalid: yaml: content");

      try {
        // Act
        await service.scanAndSave(testDataDir);

        // Assert - should not throw and valid specs should be processed
        const catalog = await service.loadSpecCatalog();
        expect(catalog.length).toBeGreaterThan(0);

        // Verify that valid specs were still processed
        const specs = await Promise.all([
          service.loadSpec("petstore").catch(() => null),
          service.loadSpec("user-management").catch(() => null),
          service.loadSpec("task-management").catch(() => null),
        ]);

        const validSpecs = specs.filter((spec) => spec !== null);
        expect(validSpecs.length).toBeGreaterThan(0);
      } finally {
        // Clean up
      }
    });
  });

  describe("persistSpec and loadSpec", () => {
    it("should persist and load a spec correctly", async () => {
      // Arrange
      const testSpec = {
        openapi: "3.0.0",
        info: {
          title: "Test API",
          version: "1.0.0",
          "x-spec-id": "test-api",
        },
        paths: {},
        components: { schemas: {} },
      };

      // Act
      await service.saveSpec(testSpec, "test-api");
      const loadedSpec = await service.loadSpec("test-api");

      // Assert
      expect(loadedSpec).toEqual(testSpec);
    });

    it("should throw error when loading non-existent spec", async () => {
      // Act & Assert
      await expect(service.loadSpec("non-existent")).rejects.toThrow(
        "Specification not found: non-existent"
      );
    });
  });

  describe("persistSpecCatalog and loadSpecCatalog", () => {
    it("should persist and load catalog correctly", async () => {
      // Arrange
      const testCatalog: SpecCatalogEntry[] = [
        {
          uri: {
            specId: "test-api",
            type: "specification",
            identifier: "test-api",
          },
          description: "Test API",
          operations: [
            {
              path: "/test",
              method: "get",
              operationId: "testOperation",
            },
          ],
          schemas: [
            {
              name: "TestSchema",
              description: "A test schema",
            },
          ],
        },
      ];

      // Act
      await service.saveSpecCatalog(testCatalog);
      const loadedCatalog = await service.loadSpecCatalog();

      // Assert
      expect(loadedCatalog).toEqual(testCatalog);
    });

    it("should return empty array when loading non-existent catalog", async () => {
      // Arrange
      await fs.rm(path.join(catalogDir, "catalog.json"), { force: true });

      // Act
      const catalog = await service.loadSpecCatalog();

      // Assert
      expect(catalog).toEqual([]);
    });
  });

  describe("initialization", () => {
    it("should scan and persist specs during initialization", async () => {
      // Arrange
      await fs.rm(catalogDir, { recursive: true, force: true });
      await fs.rm(dereferencedDir, { recursive: true, force: true });

      // Act
      const scanner = new DefaultSpecScanner(new DefaultSpecProcessor());
      const config = createTestConfig(testDataDir);
      const logger = new ConsoleLogger();
      const service = new FileSystemSpecService(scanner, config, logger);
      await service.initialize();

      // Assert
      const catalog = await service.loadSpecCatalog();
      expect(catalog.length).toBeGreaterThan(0);

      // Verify that specs were persisted
      const specs = await Promise.all([
        service.loadSpec("petstore").catch(() => null),
        service.loadSpec("user-management").catch(() => null),
        service.loadSpec("task-management").catch(() => null),
      ]);

      const validSpecs = specs.filter((spec) => spec !== null);
      expect(validSpecs.length).toBeGreaterThan(0);
    });
  });

  describe("caching behavior", () => {
    it("should return cached spec on subsequent loads", async () => {
      // Arrange
      const testSpec = {
        openapi: "3.0.0",
        info: {
          title: "Test API",
          version: "1.0.0",
          "x-spec-id": "test-api",
        },
        paths: {},
        components: { schemas: {} },
      };

      // Act
      await service.saveSpec(testSpec, "test-api");

      // First load - should read from disk
      const firstLoad = await service.loadSpec("test-api");

      // Second load - should read from cache
      const secondLoad = await service.loadSpec("test-api");

      // Assert
      expect(secondLoad).toBe(firstLoad); // Same object reference due to caching
    });

    it("should handle cache expiration", async () => {
      // Arrange
      const testSpec = {
        openapi: "3.0.0",
        info: {
          title: "Test API",
          version: "1.0.0",
          "x-spec-id": "test-api",
        },
        paths: {},
        components: { schemas: {} },
      };

      // Create service with very short TTL
      const scanner = new DefaultSpecScanner(new DefaultSpecProcessor());
      const config = createTestConfig(testDataDir);
      config.cache = { maxSize: 100, ttl: 1 }; // 1ms TTL
      const shortTTLService = new FileSystemSpecService(scanner, config);
      await shortTTLService.initialize();

      // Act
      await shortTTLService.saveSpec(testSpec, "test-api");

      // First load
      const firstLoad = await shortTTLService.loadSpec("test-api");

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second load - should read from disk due to cache expiration
      const secondLoad = await shortTTLService.loadSpec("test-api");

      // Assert
      expect(secondLoad).not.toBe(firstLoad); // Different object references
      expect(secondLoad).toEqual(firstLoad); // But same content
    });
  });

  describe("error handling", () => {
    it("should throw SpecServiceError with correct code for initialization failures", async () => {
      // Arrange
      const invalidPath = "/invalid/path/that/doesnt/exist";
      const scanner = new DefaultSpecScanner(new DefaultSpecProcessor());
      const config = createTestConfig(invalidPath);
      const service = new FileSystemSpecService(scanner, config);

      // Act & Assert
      await expect(service.initialize()).rejects.toThrow(SpecServiceError);
      await expect(service.initialize()).rejects.toMatchObject({
        code: "INIT_ERROR",
      });
    });

    it("should throw SpecServiceError with correct code for persistence failures", async () => {
      // Arrange
      const scanner = new DefaultSpecScanner(new DefaultSpecProcessor());
      const config = createTestConfig(testDataDir);
      const service = new FileSystemSpecService(scanner, config);

      // Make the directory read-only to cause a write failure
      await fs.chmod(dereferencedDir, 0o444);

      try {
        // Act & Assert
        await expect(
          service.saveSpec({} as OpenAPIV3.Document, "test")
        ).rejects.toThrow(SpecServiceError);
        await expect(
          service.saveSpec({} as OpenAPIV3.Document, "test")
        ).rejects.toMatchObject({
          code: "PERSIST_ERROR",
        });
      } finally {
        // Cleanup - make directory writable again
        await fs.chmod(dereferencedDir, 0o755);
      }
    });

    it("should throw SpecServiceError with correct code for load failures", async () => {
      // Act & Assert
      await expect(service.loadSpec("non-existent")).rejects.toThrow(
        SpecServiceError
      );
      await expect(service.loadSpec("non-existent")).rejects.toMatchObject({
        code: "LOAD_ERROR",
      });
    });
  });
});
