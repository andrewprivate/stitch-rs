export class LogTray {
    constructor() {
        this.ui = {};
        this.setupUI();
    }

    setupUI() {
        this.ui.container = document.createElement('div');
        this.ui.container.classList.add('log-tray');

        // Controls
        this.ui.controls = document.createElement('div');
        this.ui.controls.classList.add('controls');
        this.ui.container.appendChild(this.ui.controls);

        // Clear log button
        this.ui.clearLogButton = document.createElement('button');
        this.ui.clearLogButton.classList.add('clear-log-button');
        this.ui.clearLogButton.textContent = 'Clear Log';
        this.ui.clearLogButton.addEventListener('click', this.clearLog.bind(this));
        this.ui.controls.appendChild(this.ui.clearLogButton);

        // Setup scrollable area
        this.ui.scrollableArea = document.createElement('div');
        this.ui.scrollableArea.classList.add('scrollable-area');
        this.ui.container.appendChild(this.ui.scrollableArea);

        // Container for log entries
        this.ui.entriesContainer = document.createElement('div');
        this.ui.entriesContainer.classList.add('entries-container');
        this.ui.scrollableArea.appendChild(this.ui.entriesContainer);

    }

    getElement() {
        return this.ui.container;
    }

    clearLog() {
        this.ui.entriesContainer.replaceChildren();
    }

    addEntry(type, ...messages) {
        const logEntry = document.createElement('div');
        logEntry.classList.add('log-entry');
        logEntry.classList.add(type);

        const timestampElement = document.createElement('span');
        timestampElement.classList.add('timestamp');

        const messageElement = document.createElement('span');
        messageElement.classList.add('message');

        const timestamp = new Date().toLocaleTimeString();
        timestampElement.textContent = `[${timestamp}]`;

        messageElement.textContent = messages.join(' ');
        logEntry.appendChild(timestampElement);
        logEntry.appendChild(messageElement);


        // Scroll to the bottom of the log if user is already at the bottom
        const isScrolledToBottom = this.ui.scrollableArea.scrollTop + this.ui.scrollableArea.clientHeight >= this.ui.scrollableArea.scrollHeight - 10;

        this.ui.entriesContainer.appendChild(logEntry);

        if (isScrolledToBottom) {
            this.ui.scrollableArea.scrollTop = this.ui.scrollableArea.scrollHeight;
        }
    }

    log(...messages) {
        this.addEntry('log', ...messages);
    }

    warn(...messages) {
        this.addEntry('warn', ...messages);
    }

    error(...messages) {
        this.addEntry('error', ...messages);
    }

    info(...messages) {
        this.addEntry('info', ...messages);
    }
}