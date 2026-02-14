/**
 * @fileoverview Central export point for storage layer repositories
 * @module storage
 */

/**
 * Repository layer for data persistence
 *
 * This module exports all repository classes that handle CRUD operations for
 * the persistent store. Each repository implements defensive programming patterns with:
 * - Auto-initialization for packaged app compatibility
 * - Validation and sanitization of stored data
 * - Graceful degradation when store returns undefined
 * - Error handling with descriptive messages
 */

export { CollectionRepository } from './CollectionRepository.js';
export { VariableRepository } from './VariableRepository.js';
export { EnvironmentRepository } from './EnvironmentRepository.js';
export { HistoryRepository } from './HistoryRepository.js';
export { ProxyRepository } from './ProxyRepository.js';
export { WorkspaceTabRepository } from './WorkspaceTabRepository.js';
export { RunnerRepository } from './RunnerRepository.js';