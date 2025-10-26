export class IStatusDisplay {
    update(message, details) {
        throw new Error('update method must be implemented');
    }
}

export class StatusDisplayAdapter extends IStatusDisplay {
    constructor(updateStatusDisplayFunction) {
        super();
        this.updateFunction = updateStatusDisplayFunction;
    }

    update(message, details) {
        this.updateFunction(message, details);
    }
}