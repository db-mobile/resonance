/**
 * @fileoverview Lightweight registry for wiring feature stacks (Repository →
 * @module registry/FeatureRegistry
 * @typedef {Object} FeatureContext
 * @property {Object} backendAPI
 * @property {Object} statusDisplay
 * @property {Object} secretStore
 * @property {Map<string, *>} _shared
 * @property {(name: string, value: *) => *} provide
 * @property {(name: string) => *} get
 * @typedef {Object} FeatureDescriptor
 * @property {string} name
 * @property {(ctx: FeatureContext) => Object} create
 * @property {Object<string, string>} [globals]
 * @property {Object<string, string>} [provides]
 * @property {(instances: Object, ctx: FeatureContext) => (void|Promise<void>)} [init]
 */

import { app } from '../appContext.js';

export class FeatureRegistry {
    /** @param {FeatureContext} context */
    constructor(context) {
        this.ctx = context;
        /** @type {FeatureDescriptor[]} */
        this._descriptors = [];
        /** @type {Map<string, Object>} */
        this._instances = new Map();
    }

    /**
     * @param {string} name
     * @param {*} value
     * @returns {*}
     */
    provide(name, value) {
        return this.ctx.provide(name, value);
    }

    /**
     * @param {FeatureDescriptor} descriptor
     * @returns {this}
     */
    register(descriptor) {
        if (!descriptor || typeof descriptor.name !== 'string' || typeof descriptor.create !== 'function') {
            throw new Error('FeatureRegistry.register: descriptor needs a `name` and a `create(ctx)` function');
        }
        this._descriptors.push(descriptor);
        return this;
    }

    /** @returns {this} */
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
     * @param {string} name
     * @returns {Object|undefined}
     */
    get(name) {
        return this._instances.get(name);
    }
}
