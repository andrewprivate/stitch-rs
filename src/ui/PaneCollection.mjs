import { EventEmitter } from "../modules/EventEmitter.mjs";
import { Sortable } from "../modules/Sortable.mjs";


export class ContentPane extends EventEmitter {
    constructor() {
        super();
        this.name = 'Content Pane';
        this.icon = null;
        this.ui = {};
        this.setupUI();
    }

    setupUI() {
        this.ui.container = document.createElement('div');
        this.ui.container.classList.add('content-pane');

        this.ui.menuItem = document.createElement('div');
        this.ui.menuItem.classList.add('menu-item');
        this.ui.menuItem.addEventListener('click', () => {
            this.emit('select', this);
        });
        
        this.ui.iconElement = document.createElement('div');
        this.ui.iconElement.classList.add('icon');
        this.ui.menuItem.appendChild(this.ui.iconElement);

        this.ui.nameElement = document.createElement('span');
        this.ui.nameElement.classList.add('name');
        this.ui.nameElement.textContent = this.name;
        this.ui.menuItem.appendChild(this.ui.nameElement);

        this.ui.closeButton = document.createElement('button');
        this.ui.closeButton.classList.add('close-button');
        this.ui.closeButton.textContent = 'X';
        this.ui.closeButton.addEventListener('click', (e) => {
            this.emit('close');
            e.stopPropagation();
        });
        this.ui.menuItem.appendChild(this.ui.closeButton);

    }

    setName(name) {
        this.name = name;
        this.ui.nameElement.textContent = name;
        this.ui.nameElement.title = name;
    }

    getElement() {
        return this.ui.container;
    }

    getMenuItem() {
        return this.ui.menuItem;
    }
}

export class PaneCollection {
    constructor() {
        this.ui = {};
        this.panes = [];
        this.activePane = null;
        this.setupUI();
    }

    setupUI() {
        this.ui.container = document.createElement('div');
        this.ui.container.classList.add('pane-collection');

        // Setup pane menu
        this.ui.paneMenu = document.createElement('div');
        this.ui.paneMenu.classList.add('pane-menu');
        this.ui.container.appendChild(this.ui.paneMenu);

        // Setup scrollable menu area
        this.ui.scrollableMenuArea = document.createElement('div');
        this.ui.scrollableMenuArea.classList.add('scrollable-menu-area');
        this.ui.paneMenu.appendChild(this.ui.scrollableMenuArea);

        // Setup content area
        this.ui.contentArea = document.createElement('div');
        this.ui.contentArea.classList.add('content-area');
        this.ui.container.appendChild(this.ui.contentArea);

        Sortable.create(this.ui.scrollableMenuArea);
    }

    addPane(pane) {
        this.ui.scrollableMenuArea.appendChild(pane.getMenuItem());

        pane.on('close', () => {
            this.removePane(pane);
        });

        pane.on('select', () => {
            this.setActivePane(pane);
        });

        this.panes.push(pane);

        if (!this.activePane) {
            this.setActivePane(pane);
        }
    }

    removePane(pane) {
        this.ui.scrollableMenuArea.removeChild(pane.getMenuItem());
        const index = this.panes.indexOf(pane);
        if (index > -1) {
            this.panes.splice(index, 1);
        }
        if (this.activePane === pane) {
            if (index > 0 && index <= this.panes.length) {
                this.setActivePane(this.panes[index - 1]);
            } else if (index < this.panes.length) {
                this.setActivePane(this.panes[index]);
            } else {
                this.setActivePane(null);
            }
        }
    }

    setActivePane(pane) {
        if (this.activePane) {
            this.activePane.getMenuItem().classList.remove('active');
            this.ui.contentArea.removeChild(this.activePane.getElement());
        }
        this.activePane = pane;
        if (pane) {
            this.ui.contentArea.appendChild(pane.getElement());

            // Scroll to the active pane menu item, sideway
            const menuItem = pane.getMenuItem();
            const scrollableArea = this.ui.scrollableMenuArea;
            const offset = menuItem.offsetLeft - scrollableArea.clientWidth / 2 + menuItem.clientWidth / 2;
            scrollableArea.scrollLeft = offset;

            menuItem.classList.add('active');
        }
    }

    getElement() {
        return this.ui.container;
    }
}