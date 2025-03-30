import { describe, beforeAll, afterAll, it, expect, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { FileSystemSpecService } from '../SpecService';
import { SpecCatalogEntry, SpecServiceConfig } from '../interfaces/ISpecService';
import { DefaultSpecScanner } from '../SpecScanner';
import { DefaultSpecProcessor } from '../SpecProcessor';
import { ConsoleLogger } from '../Logger';

describe('FileSystemSpecService - Explorer', () => {
  const testDataDir = 'test/data';
  let service: FileSystemSpecService;

  const createTestConfig = (basePath: string): SpecServiceConfig => ({
    basePath,
    catalogDir: '_catalog',
    dereferencedDir: '_dereferenced',
    cache: {
      maxSize: 100,
      ttl: 1000 * 60 * 5 // 5 minutes for tests
    }
  });

  beforeAll(async () => {
    // Clean up test directories
    await fs.rm(path.join(testDataDir, '_catalog'), { recursive: true, force: true });
    await fs.rm(path.join(testDataDir, '_dereferenced'), { recursive: true, force: true });

    const scanner = new DefaultSpecScanner(new DefaultSpecProcessor());
    const config = createTestConfig(testDataDir);
    const logger = new ConsoleLogger();
    
    service = new FileSystemSpecService(scanner, config, logger);
    
    // Initialize service (this will scan and persist specs)
    await service.initialize();
  });

  afterAll(async () => {
    try {
      await fs.rm(path.join(testDataDir, '_dereferenced'), { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
      console.warn("Failed to clean up test directory:", error);
    }
  });

  describe('findSchemaByName', () => {
    it('should find Pet schema in petstore spec', async () => {
      // Act
      const result = await service.findSchemaByName('petstore', 'Pet');

      // Assert
      expect(result).toBeDefined();
      expect(result?.name).toBe('Pet');
      expect(result?.schema).toBeDefined();
      expect(result?.schema.properties?.breed).toBeDefined();
      expect(result?.schema.properties?.category).toBeDefined();
      expect(result?.uri).toBe('apis://petstore/schemas/Pet');
    });

    it('should find Task schema in task-management spec', async () => {
      // Act
      const result = await service.findSchemaByName('task-management', 'Task');

      // Assert
      expect(result).toBeDefined();
      expect(result?.name).toBe('Task');
      expect(result?.schema.properties?.assignee).toBeDefined();
      expect(result?.schema.properties?.dueDate).toBeDefined();
      expect(result?.uri).toBe('apis://task-management/schemas/Task');
    });

    it('should return null for non-existent schema', async () => {
      // Act
      const result = await service.findSchemaByName('petstore', 'NonExistentSchema');

      // Assert
      expect(result).toBeNull();
    });

    it('should return null for non-existent spec', async () => {
      // Act
      const result = await service.findSchemaByName('non-existent', 'Pet');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findOperationById', () => {
    it('should find listPets operation in petstore spec', async () => {
      // Act
      const result = await service.findOperationById('petstore', 'listPets');

      // Assert
      expect(result).toBeDefined();
      expect(result?.path).toBe('/pets');
      expect(result?.method).toBe('get');
      expect(result?.operation.operationId).toBe('listPets');
      expect(result?.uri).toBe('apis://petstore/operations/listPets');
    });

    it('should find createTask operation in task-management spec', async () => {
      // Act
      const result = await service.findOperationById('task-management', 'createTask');

      // Assert
      expect(result).toBeDefined();
      expect(result?.path).toBe('/tasks');
      expect(result?.method).toBe('post');
      expect(result?.operation.operationId).toBe('createTask');
      expect(result?.uri).toBe('apis://task-management/operations/createTask');
    });

    it('should return null for non-existent operation', async () => {
      // Act
      const result = await service.findOperationById('petstore', 'nonExistentOperation');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findOperationByPathAndMethod', () => {
    it('should find operation by path and method in petstore spec', async () => {
      // Act
      const result = await service.findOperationByPathAndMethod('petstore', '/pets', 'get');

      // Assert
      expect(result).toBeDefined();
      expect(result?.operation.operationId).toBe('listPets');
      expect(result?.method).toBe('get');
      expect(result?.path).toBe('/pets');
    });

    it('should find operation by path and method in task-management spec', async () => {
      // Act
      const result = await service.findOperationByPathAndMethod('task-management', '/tasks/{taskId}/status', 'put');

      // Assert
      expect(result).toBeDefined();
      expect(result?.operation.operationId).toBe('updateTaskStatus');
      expect(result?.method).toBe('put');
      expect(result?.path).toBe('/tasks/{taskId}/status');
    });

    it('should return null for non-existent path', async () => {
      // Act
      const result = await service.findOperationByPathAndMethod('petstore', '/non-existent', 'get');

      // Assert
      expect(result).toBeNull();
    });

    it('should return null for non-existent method on valid path', async () => {
      // Act
      const result = await service.findOperationByPathAndMethod('petstore', '/pets', 'delete');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('searchOperations', () => {
    it('should find operations matching search query', async () => {
      // Act
      const results = await service.searchOperations('list');

      // Assert
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.operation.operationId === 'listPets')).toBe(true);
      expect(results.some(r => r.operation.operationId === 'listUsers')).toBe(true);
    });

    it('should find operations in specific spec when specId is provided', async () => {
      // Act
      const results = await service.searchOperations('create', 'petstore');

      // Assert
      expect(results.length).toBe(1);
      expect(results[0].operation.operationId).toBe('createPet');
    });

    it('should return empty array when no matches found', async () => {
      // Act
      const results = await service.searchOperations('nonexistent');

      // Assert
      expect(results).toEqual([]);
    });
  });

  describe('searchSchemas', () => {
    it('should find schemas matching search query', async () => {
      // Act
      const results = await service.searchSchemas('task');

      // Assert
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.name === 'Task')).toBe(true);
      expect(results.some(r => r.name === 'BaseTask')).toBe(true);
    });

    it('should find schemas in specific spec when specId is provided', async () => {
      // Act
      const results = await service.searchSchemas('pet', 'petstore');

      // Assert
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.name === 'Pet')).toBe(true);
      expect(results.some(r => r.name === 'PetWithVaccinations')).toBe(true);
    });

    it('should return empty array when no matches found', async () => {
      // Act
      const results = await service.searchSchemas('nonexistent');

      // Assert
      expect(results).toEqual([]);
    });
  });
});
