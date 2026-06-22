/**
 * @fileoverview Lightweight registry for wiring feature stacks (Repository →
 * Service → Controller → UI) declaratively, replacing manual wiring in renderer.js.
 * @module registry/FeatureRegistry
 *
 * Each feature supplies a descriptor with a `create(ctx)` factory. The registry
 * standardizes the boot mechanics — construction order, app-context exposure, the
 * cross-feature singleton bus, and initialization — while `create` captures each
 * feature's unique dependencies (which vary too much for a one-size-fits-all factory).
 *
 * @typedef {Object} FeatureContext
 * @property {Object} backendAPI - The IPC bridge (window.backendAPI).
 * @property {Object} statusDisplay - Shared status display adapter.
 * @property {Object} secretStore - Shared OS-keychain secret backend.
 * @property {Map<string, *>} _shared - Cross-feature singleton bus.
 * @property {(name: string, value: *) => *} provide - Publish a singleton onto the bus.
 * @property {(name: string) => *} get - Read a singleton from the bus.
 *
 * @typedef {Object} FeatureDescriptor
 * @property {string} name - Unique feature name (registry/bus key).
 * @property {(ctx: FeatureContext) => Object} create - Builds and returns the feature's
 *   instances keyed by role, e.g. `{ repository, service, controller }`.
 * @property {Object<string, string>} [globals] - Map of app-context key → instance key to
 *   expose on the shared `app` locator, e.g. `{ cookieController: 'controller' }`.
 * @property {Object<string, string>} [provides] - Map of bus name → instance key to publish
 *   onto the shared bus so other features can `ctx.get(busName)` them, e.g.
 *   `{ environmentService: 'service' }`.
 * @property {(instances: Object, ctx: FeatureContext) => (void|Promise<void>)} [init] -
 *   Optional startup hook (e.g. cache warming, listener registration). Run fire-and-forget
 *   during boot to preserve existing non-blocking init timing.
 */

import { app } from '../appContext.js';

/**
 * Registers feature descriptors and boots them in registration order.
 *
 * @class
 */
export class FeatureRegistry {
    /**
     * @param {FeatureContext} context - Shared singletons and the cross-feature bus.
     */
    constructor(context) {
        this.ctx = context;
        /** @type {FeatureDescriptor[]} */
        this._descriptors = [];
        /** @type {Map<string, Object>} */
        this._instances = new Map();
    }

    /**
     * Publishes a singleton onto the shared bus so feature descriptors can read it via
     * `ctx.get(name)`. Convenience passthrough for wiring not-yet-registry-managed
     * singletons (e.g. environmentService) before {@link boot}.
     *
     * @param {string} name
     * @param {*} value
     * @returns {*} The published value.
     */
    provide(name, value) {
        return this.ctx.provide(name, value);
    }

    /**
     * Registers a feature descriptor. Does not construct anything until {@link boot}.
     *
     * @param {FeatureDescriptor} descriptor
     * @returns {this} For chaining.
     */
    register(descriptor) {
        if (!descriptor || typeof descriptor.name !== 'string' || typeof descriptor.create !== 'function') {
            throw new Error('FeatureRegistry.register: descriptor needs a `name` and a `create(ctx)` function');
        }
        this._descriptors.push(descriptor);
        return this;
    }

    /**
     * Constructs every registered feature in order: build instances, expose globals,
     * publish provided singletons, then run the (fire-and-forget) init hook.
     *
     * Construction and global/bus exposure are synchronous so callers can immediately
     * read instances via {@link get}. The optional `init` hook runs non-blocking to
     * preserve the existing fire-and-forget init timing; rejections are logged.
     *
     * @returns {this} For chaining.
     */
    boot() {
        for (const descriptor of this._descriptors) {
            const instances = descriptor.create(this.ctx);
            this._instances.set(descriptor.name, instances);

            if (descriptor.globals) {
                for (const [appKey, instanceKey] of Object.entries(descriptor.globals)) {
                    app[appKey] = instances[instanceKey];
                }
            }

            if (descriptor.provides) {
                for (const [busName, instanceKey] of Object.entries(descriptor.provides)) {
                    this.ctx.provide(busName, instances[instanceKey]);
                }
            }

            if (typeof descriptor.init === 'function') {
                Promise.resolve()
                    .then(() => descriptor.init(instances, this.ctx))
                    .catch((err) => console.error(`Feature "${descriptor.name}" init failed:`, err));
            }
        }
        return this;
    }

    /**
     * Returns a booted feature's instances object (e.g. `{ repository, service, controller }`),
     * for any caller that still needs a direct reference.
     *
     * @param {string} name - The feature's descriptor name.
     * @returns {Object|undefined}
     */
    get(name) {
        return this._instances.get(name);
    }
}
