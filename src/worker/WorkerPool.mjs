import { WorkerMessageHandler } from "./WorkerMessageHandler.mjs";

export class WorkerPool {
    constructor(workerLocation, size, taskLimit) {
        this.closed = false;
        this.size = size || navigator.hardwareConcurrency || 2;
        this.pool = [];
        this.workerLocation = workerLocation;
        this.taskLimit = taskLimit || 2;
    }

    async init() {
        if (this.pool.length > 0 || this.closed) {
            return;
        }

        for (let i = 0; i < this.size; i++) {
            const worker = new Worker(this.workerLocation, { type: 'module' });
            this.pool.push({
                handler: new WorkerMessageHandler(worker),
                tasks: 0
            });
        }
    }

    emitBulk(event, argsList) {

        if (this.closed) {
            throw new Error("WorkerPool is closed");
        }

        const todoQueue = argsList.map((a, i) => {
            return {
                args: a,
                index: i
            };
        });

        const results = new Array(argsList.length);
        const resultCalls = new Array(argsList.length);

        for (let i = 0; i < results.length; i++) {
            results[i] = new Promise((resolve, reject) => {
                resultCalls[i] = [resolve, reject];
            });
        }

        let run, distribute;

        distribute = () => {
            if (todoQueue.length === 0) {
                return;
            }

            if (this.pool.length === 0) {
                resultCalls.forEach((calls, i) => {
                    if (calls) {
                        calls[1](new Error("No workers available"));
                    }
                });
                todoQueue.length = 0;
                return;
            }

            const availableRunners = this.pool.filter(r => r.tasks < this.taskLimit);
            if (availableRunners.length === 0) {
                return;
            }

            // Sort by least busy
            availableRunners.sort((a, b) => a.tasks - b.tasks);
            
            // Pyramid fill, distribute tasks to least busy workers
            let index = 0;
            while (todoQueue.length > 0 && index < availableRunners.length) {
                const todo = todoQueue.shift();
                const runner = availableRunners[index];

                run(runner, todo);

                if (index === availableRunners.length - 1) {
                    break;
                }

                const nextRunner = availableRunners[index + 1];
                if (nextRunner.tasks >= runner.tasks) {
                    index = 0;
                } else {
                    index++;
                }
            }

        }

        run = async (runner, todo) => {
            let { args, index } = todo;
            runner.tasks++;

            if (typeof args === 'function') {
                args = await args(index);
            }

            try {
                let result = await runner.handler.emit(event, ...args);
                resultCalls[index][0](result);
            } catch (e) {
                resultCalls[index][1](e);
            }

            resultCalls[index] = null;

            runner.tasks--;

            distribute();
        }

        this.init().then(() => {
            distribute();
        });

        return results;
    }

    close() {
        if (this.closed) {
            console.error("WorkerPool is already closed");
            return;
        }
        this.closed = true;
        this.pool.forEach(r => r.handler.close());
        this.pool = [];
    }
}