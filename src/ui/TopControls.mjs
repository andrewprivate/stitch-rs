import { EventEmitter } from "../modules/EventEmitter.mjs";

export class TopControls extends EventEmitter {
    constructor(controller) {
        super();
        this.controller = controller;
        this.ui = {};
        this.setupUI();
    }

    setupUI() {
        this.ui.container = document.createElement('div');
        this.ui.container.classList.add('top-controls');

        // Create open folder button
        this.openFolderButton = document.createElement('button');
        this.openFolderButton.classList.add('open-folder-button');
        this.openFolderButton.textContent = 'Open Folder';
        this.openFolderButton.addEventListener('click', this.openFolder.bind(this));
        this.ui.container.appendChild(this.openFolderButton);
    }

    openFolder() {
        this.controller.openFolder();
    }

    getElement() {
        return this.ui.container;
    }
}