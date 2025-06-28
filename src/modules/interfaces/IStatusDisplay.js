/**
 * Interface for status display implementations
 * Follows Interface Segregation Principle - focused interface
 */
export class IStatusDisplay {
    update(message, details) {
        throw new Error('update method must be implemented');
    }
}

/**
 * Concrete implementation of status display
 */
export class StatusDisplayAdapter extends IStatusDisplay {
    constructor(updateStatusDisplayFunction) {
        super();
        this.updateFunction = updateStatusDisplayFunction;
    }

    update(message, details) {
        this.updateFunction(message, details);
    }
}