/**
 * Authentication options for URL sources
 */
export interface UrlAuth {
  /** Type of authentication */
  type: "bearer" | "basic" | "custom";
  /** Position of the auth parameter (only applicable for custom auth) */
  position?: "header" | "query";
  /** Authentication value based on type:
   * - bearer: The bearer token
   * - basic: { username: string, password: string }
   * - custom: { name: string, value: string }
   */
  value: string | { username: string; password: string } | { name: string; value: string };
}

/**
 * File system source configuration
 */
export interface FileSpecSource {
  type: "file";
  /** Path to the OpenAPI specification file or directory */
  path: string;
  /** Unique identifier for the specification, used as filename when saving */
  specId: string;
}

/**
 * URL source configuration
 */
export interface UrlSpecSource {
  type: "url";
  /** URL of the OpenAPI specification */
  url: string;
  /** Unique identifier for the specification, used as filename when saving */
  specId: string;
  /** Optional authentication configuration */
  auth?: UrlAuth;
}

/**
 * Union type for all specification sources
 */
export type SpecSource = FileSpecSource | UrlSpecSource;

/**
 * Configuration for synchronization
 */
export interface SyncConfig {
  /** List of specification sources to sync from */
  sources: SpecSource[];
  /** Directory where specifications will be stored */
  targetDirectory: string;
  /** Optional interval for automatic synchronization (in milliseconds) */
  syncInterval?: number;
}

/**
 * Result of a synchronization operation
 */
export interface SyncResult {
  /** Whether the sync was successful */
  success: boolean;
  /** When the sync was performed */
  timestamp: Date;
  /** Name of the file that was synced */
  filename: string;
  /** Optional error if sync failed */
  error?: Error;
}

/**
 * Interface for managing synchronization of specifications
 */
export interface ISyncManager {
  /**
   * Synchronize specifications from sources to target directory
   * @param config Configuration for the sync operation
   * @returns Array of results for each synced specification
   */
  sync(config: SyncConfig): Promise<SyncResult[]>;
}

