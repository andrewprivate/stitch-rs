import { EventEmitter } from "../modules/EventEmitter.mjs";

export const FileBrowserEntryType = {
    FILE: 'file',
    DIRECTORY: 'directory'
}

export class FileBrowserEntry extends EventEmitter {
    constructor() {
        super();
        this.name = '';
        this.type = FileBrowserEntryType.FILE;
        this.visible = true;
        this.collapsed = false;
        this.icon = null;
        this.children = [];

        this.ui = {};

        this.setupUI();
    }

    setupUI() {
        const entryElement = document.createElement('div');
        entryElement.classList.add('file-browser-entry');

        const iconElement = document.createElement('div');
        iconElement.classList.add('icon');

        const nameElement = document.createElement('span');
        nameElement.classList.add('name');
        nameElement.textContent = this.name;

        entryElement.appendChild(iconElement);
        entryElement.appendChild(nameElement);

        this.ui.iconElement = iconElement;
        this.ui.nameElement = nameElement;
        this.ui.entryElement = entryElement;

        // Add click event to the entry
        entryElement.addEventListener('click', () => {
            this.emit('select');
        });
    }

    setName(name) {
        this.name = name;
        this.ui.nameElement.textContent = name;
        this.ui.nameElement.title = name;
    }

    getElement() {
        return this.ui.entryElement;
    }
    
}

export class FileBrowser extends EventEmitter{
    constructor() {
        super();
        this.entries = [];
        this.ui = {};
        this.setupUI();
    }

    getElement() {
        return this.ui.container;
    }

    setupUI() {
        this.ui.container = document.createElement('div');
        this.ui.container.classList.add('file-browser');

        // Create scrollable area
        this.ui.scrollableArea = document.createElement('div');
        this.ui.scrollableArea.classList.add('scrollable-area');
        this.ui.container.appendChild(this.ui.scrollableArea);

        // Container for entries
        this.ui.entriesContainer = document.createElement('div');
        this.ui.entriesContainer.classList.add('entries-container');
        this.ui.scrollableArea.appendChild(this.ui.entriesContainer);


    }

    selectEntry(entry) {
        // Find previously selected entry and deselect it
        const previouslySelected = this.entries.find(e => e.selected);
        if (previouslySelected) {
            previouslySelected.selected = false; // Deselect previously selected entry
            previouslySelected.getElement().classList.remove('selected'); // Remove selected class from UI
        }

        entry.selected = true; // Select the clicked entry
        entry.getElement().classList.add('selected'); // Add selected class to UI

        this.emit('entrySelected', entry); // Emit event for selected entry
    }

    unselectEntry(entry) {
        entry.selected = false;
        entry.getElement().classList.remove('selected');
    }

    addEntry(entry) {
        this.entries.push(entry);
        this.ui.entriesContainer.appendChild(entry.getElement());

        entry.on('select', () => {
            this.selectEntry(entry);
        });

        this.updatePositions();
    }

    updatePositions() {
        let startPos = 0;
        this.entries.forEach(entry => {
            entry.getElement().style.top = `${startPos}px`;
            startPos += entry.getElement().offsetHeight; // Update start position for next entry
        });

    }

    populate(entries) {
        this.ui.entriesContainer.replaceChildren(); // Clear existing entries
        entries.forEach(entry => {
            this.addEntry(entry);
        });
    }
}