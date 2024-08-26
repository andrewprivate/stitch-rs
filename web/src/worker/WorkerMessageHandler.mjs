import { Utils } from "../utils/Utils.mjs";

export const MessageTypes = {
    EVENT: 'event',
    RESPONSE: 'response',
    PROXY: 'proxy',
}

export class MessageHandler {
    constructor(sendMessage) {
        this.closed = false
        this.sourceCallbacks = [];
        this.otherCallbacks = [];
        this.listeners = new Map()
        this.sendMessage = sendMessage

        this.lastID = 0
    }

    nextRequestId() {
        if (this.lastID === Number.MAX_SAFE_INTEGER) {
            this.lastID = 0
        }
        return this.lastID++
    }

    onMessage(data) {
        if (this.closed) {
            console.error('MessageHandler is closed but received message', data)
            return;
        }

        switch (data.type) {
            case MessageTypes.EVENT:
                this.onEvent(data)
                break
            case MessageTypes.RESPONSE:
                this.onResponse(data)
                break
            case MessageTypes.PROXY:
                this.onProxy(data)
                break
        }
    }

    onProxy(data) {
        const { id, message, useTemp } = data
        const callbacks = useTemp ? this.otherCallbacks : this.sourceCallbacks
        const index = Utils.binarySearch(callbacks, id, (a, b) => a.id - b)
        if (index < 0) {
            console.error('No callback for proxy', id)
            return
        }

        const { subMessageHandler } = callbacks[index]
        if (!subMessageHandler) {
            console.error('No subMessageHandler for proxy', id)
            return
        }

        subMessageHandler.onMessage(message)
    }

    async onEvent(data) {
        const { id, event, args, argFnsIndexes } = data

        let tempMessageHandler = null;
        if (argFnsIndexes.length) {
            tempMessageHandler = new MessageHandler(this.generateProxiedSendFunction(id, false));

            const index = Utils.binarySearch(this.otherCallbacks, id, (a, b) => a.id - b);
            if (index < 0) {
                throw new Error('ID collision');
            }

            this.otherCallbacks.splice(~index, 0, { id, subMessageHandler: tempMessageHandler });

            argFnsIndexes.forEach((index, i) => {
                args[index] = tempMessageHandler.generateEmitterWith('__fn' + i);
            });
        }

        const listeners = this.listeners.get(event)
        let responses = [];
        let errors = [];
        if (listeners) {
            try {
                responses = await Promise.all(listeners.map(async listener => {
                    try {
                        const response = await listener(...args)
                        return response
                    } catch (err) {
                        console.error('Listener throws error', data)
                        console.error(err)
                        errors.push(err);
                    }
                }))
            } catch (er) {
                console.error('Error in event', data)
                console.error(er)
                errors.push(er);
            }
        } else {
            console.warn('No listeners for event', event)
        }

        if (tempMessageHandler) {
            tempMessageHandler.close();
            const index = Utils.binarySearch(this.otherCallbacks, id, (a, b) => a.id - b);
            if (index < 0) {
                console.error('Missing tempMessageHandler', id, event)
            } else {
                this.otherCallbacks.splice(index, 1);
            }
        }

        this.sendMessage({
            type: MessageTypes.RESPONSE,
            id,
            responses,
            errors
        })
    }

    onResponse(data) {
        const { id, responses, errors } = data
        const index = Utils.binarySearch(this.sourceCallbacks, id, (a, b) => a.id - b)
        if (index < 0) {
            console.warn('No promise for response', data)
            return
        }

        const callbacks = this.sourceCallbacks[index]
        if (callbacks.subMessageHandler) {
            callbacks.subMessageHandler.close();
        }
        this.sourceCallbacks.splice(index, 1)

        try {
            if (errors.length) {
                callbacks.reject(errors.length > 1 ? errors : errors[0])
            } else {
                callbacks.resolve(responses.length > 1 ? responses : responses[0])
            }
        } catch (error) {
            console.error('Promise throws error', data)
            throw error
        }
    }

    generateProxiedSendFunction(id, useTemp) {
        return (message) => {
            this.sendMessage({
                type: MessageTypes.PROXY,
                useTemp: useTemp,
                id,
                message
            })
        }
    }

    generateEmitterWith(event) {
        return (...args) => {
            return this.emit(event, ...args)
        }
    }

    emit(event, ...args) {
        if (this.closed) {
            console.error('MessageHandler is closed but tried to emit event', event)
            return Promise.reject('MessageHandler is closed')
        }

        const id = this.nextRequestId();

        const argFnsIndexes = [];
        const argFns = [];
        
        args = args.map((arg, index) => {
            if (typeof arg === 'function') {
                argFnsIndexes.push(index);
                argFns.push(arg);
                return null;
            }
            return arg;
        });

        let subMessageHandler = null;
        if (argFns.length) {
            subMessageHandler = new MessageHandler(this.generateProxiedSendFunction(id, true));
            argFns.forEach((fn, index) => {
                subMessageHandler.on('__fn' + index, fn);
            });
        }

        this.sendMessage({
            type: MessageTypes.EVENT,
            id,
            event,
            args,
            argFnsIndexes
        })

        return new Promise((resolve, reject) => {
            const index = Utils.binarySearch(this.sourceCallbacks, id, (a, b) => a.id - b);
            if (index >= 0) {
                console.warn('Duplicate promise id', id)
                return reject('Duplicate promise id');
            }
            this.sourceCallbacks.splice(~index, 0, { id, resolve, reject, subMessageHandler })
        })
    }

    on(event, callback) {
        if (this.closed) {
            console.error('MessageHandler is closed but tried to add listener', event, callback)
            return false
        }

        let listeners = this.listeners.get(event)
        if (!listeners) {
            listeners = []
            this.listeners.set(event, listeners)
        }

        if (listeners.indexOf(callback) >= 0) {
            return false;
        }

        listeners.push(callback)
        return true
    }

    off(event, callback) {
        if (this.closed) {
            console.error('MessageHandler is closed but tried to remove listener', event, callback)
            return false
        }

        const listeners = this.listeners.get(event)
        if (listeners) {
            const index = listeners.indexOf(callback)
            if (index >= 0) {
                listeners.splice(index, 1)
                return true
            }
        }
        return false;
    }

    once(event, callback) {
        const handler = (...args) => {
            this.off(event, handler)
            callback(...args)
        }
        return this.on(event, handler)
    }

    close() {
        if (this.closed) {
            console.error('MessageHandler is already closed')
            return
        }

        this.sendMessage = null;
        this.closed = true
        this.sourceCallbacks.forEach(({ subMessageHandler, reject }) => {
            if (subMessageHandler) {
                subMessageHandler.close();
            }

            reject('MessageHandler is closed');
        });
        this.sourceCallbacks = [];
        this.otherCallbacks.forEach(({ subMessageHandler }) => {
            subMessageHandler.close();
        });
        this.otherCallbacks = [];
        this.listeners.clear()
    }
}

export class WorkerMessageHandler {
    constructor(channel) {
        this.channel = channel;
        this.messageHandler = new MessageHandler(this.sendMessage.bind(this));
        this.channel.addEventListener('message', this.onMessage.bind(this))
    }

    sendMessage(message) {
        this.channel.postMessage(message)
    }

    onMessage(event) {
        this.messageHandler.onMessage(event.data)
    }

    emit(event, ...args) {
        return this.messageHandler.emit(event, ...args)
    }

    on(event, callback) {
        return this.messageHandler.on(event, callback)
    }

    off(event, callback) {
        return this.messageHandler.off(event, callback)
    }

    once(event, callback) {
        return this.messageHandler.once(event, callback)
    }

    close() {
        if (!this.channel) {
            console.error('WorkerMessageHandler is already closed')
            return
        }
        this.messageHandler.close();
        this.channel.terminate();
        this.channel = null;
    }
}