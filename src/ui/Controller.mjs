import { GrayImage3D } from "../Image.mjs";
import { FileUtils } from "../utils/FileUtils.mjs";
import { ParallelImageParser } from "../worker/ParallelImageParser.mjs";
import { FileBrowser, FileBrowserEntry } from "./FileBrowser.mjs";
import { GridStitchSetup } from "./GridStitchSetup.mjs";
import { LogTray } from "./LogTray.mjs";
import { ContentPane, PaneCollection } from "./PaneCollection.mjs";
import { Panel, ResizeablePanels } from "./ResizeablePanels.mjs";
import { StitchVisualizer } from "./StitchVisualizer.mjs";
import { TopControls } from "./TopControls.mjs";
import { Viewer3DSlice, Viewer3DSliceWithControls } from "./Viewer3D.mjs";

export class Controller {
    constructor() {
        this.ui = {};

        this.renderQueue = [];

        this.setupUI();
    }

    setupUI() {
        this.logTray = new LogTray();
        const oldConsoleError = console.error;
        console.error = (...args) => {
            oldConsoleError(...args);
            this.logTray.error(...args);
        };

        const oldConsoleLog = console.log;
        console.log = (...args) => {
            oldConsoleLog(...args);
            this.logTray.log(...args);
        };

        const oldConsoleWarn = console.warn;
        console.warn = (...args) => {
            oldConsoleWarn(...args);
            this.logTray.warn(...args);
        };

        window.onerror = (message, source, lineno, colno, error) => {
            this.logTray.error(message, source, lineno, colno, error);
        }

        this.ui.container = document.createElement('div');
        this.ui.container.classList.add('web-stitch');

        this.topControls = new TopControls(this);
        this.ui.container.appendChild(this.topControls.getElement());

        this.ui.contentContainer = document.createElement('div');
        this.ui.contentContainer.classList.add('content-container');
        this.ui.container.appendChild(this.ui.contentContainer);

        this.fileBrowser = new FileBrowser();
        this.ui.sidebarPanel = new Panel();
        this.ui.sidebarPanel.getElement().appendChild(this.fileBrowser.getElement());

        this.paneCollection = new PaneCollection();
        this.ui.contentPanePanel = new Panel();
        this.ui.contentPanePanel.getElement().appendChild(this.paneCollection.getElement());
       
        this.ui.logPanel = new Panel();
        this.ui.logPanel.getElement().appendChild(this.logTray.getElement());
        

        this.ui.sidebarPanel.setBounds(0, 0, 0.2, 1);
        this.ui.contentPanePanel.setBounds(0.2, 0, 1, 0.8);
        this.ui.logPanel.setBounds(0.2, 0.8, 1, 1);


        this.resizeablePanels = new ResizeablePanels();
        this.resizeablePanels.setPanels([
            this.ui.sidebarPanel,
            this.ui.contentPanePanel,
            this.ui.logPanel
        ]);

        this.ui.contentContainer.appendChild(this.resizeablePanels.getElement());
    }

    addToRenderQueue(renderable) {
        this.renderQueue.push(renderable);
        if (!this.renderLoopRunning) {
            this.renderLoopRunning = true;
            requestAnimationFrame(this.renderLoop.bind(this));
        }
    }

    removeFromRenderQueue(renderable) {
        const index = this.renderQueue.indexOf(renderable);
        if (index > -1) {
            this.renderQueue.splice(index, 1);
        }
    }

    async renderLoop() {
        if (!this.renderQueue.length) {
            this.renderLoopRunning = false;
            return;
        }

        try {
            await Promise.all(this.renderQueue.map(renderable => renderable.render()));
        } catch (error) {
            console.error(error);
        }
        
        requestAnimationFrame(this.renderLoop.bind(this));
    }

    getElement() {
        return this.ui.container;
    }

    resize() {
        // Implement resize logic if needed
    }

    async openFolder() {
        const dirHandle = await window.showDirectoryPicker({
            id: "stitch-input",
            mode: "readwrite"
        });

        this.fs = dirHandle;
        this.entries = await FileUtils.getEntries(this.fs);
        this.entries.forEach((entry)=>{
            const browserEntry = new FileBrowserEntry();
            browserEntry.setName(entry.name);
            this.fileBrowser.addEntry(browserEntry);

            entry.browserEntry = browserEntry; // Store reference to browserEntry in entry

            browserEntry.on('select', async () => {
                
                if (entry.viewerPane) {
                    this.paneCollection.setActivePane(entry.viewerPane);
                } else {
                    console.log(`Opening: ${entry.name}`);
               
                    entry.viewerPane = new ContentPane();
                    entry.viewerPane.setName(entry.name);
                    this.paneCollection.addPane(entry.viewerPane);
                    this.paneCollection.setActivePane(entry.viewerPane);

                    entry.viewerPane.on('close', () => {
                        entry.viewerPane = null; // Clear reference when closed
                        this.fileBrowser.unselectEntry(entry.browserEntry); // Unselect the entry in the file browser

                        if (entry.viewer) {
                            this.removeFromRenderQueue(entry.viewer);
                            entry.viewer = null;
                        } else if (entry.editor) {

                            entry.editor = null;
                            entry.editorContainer = null;
                        }
                    });

                    entry.viewerPane.on('select', () => {
                        this.fileBrowser.selectEntry(entry.browserEntry); // Select the entry in the file browser
                    });

                    if (entry.imagePromise) {
                        let image = await entry.imagePromise; // Wait for the image to load
                        const viewer = new Viewer3DSliceWithControls();
                        viewer.setImage(image);
                        entry.viewerPane.getElement().appendChild(viewer.getElement());
                        entry.viewer = viewer; // Store reference to viewer in entry

                        this.addToRenderQueue(viewer);
                    } else {
                        // get file
                        const file = await entry.getFile();
                        // Check if text file
                        if (entry.isText() || file.type.startsWith("text")) {
                            const text = await file.text();

                            const editor = document.createElement('div');
                            editor.classList.add('text-editor');
                            entry.viewerPane.getElement().appendChild(editor);
                            
                            const aceEditor = window.ace.edit(editor);
                            aceEditor.setValue(text, -1);

                            entry.editor = aceEditor;
                            entry.editorContainer = editor;

                            aceEditor.commands.addCommand({
                                name: 'Save',
                                bindKey: {win: 'Ctrl-S',  mac: 'Command-S'},
                                exec: async function(editor) {
                                    const data = editor.getValue();
                                    await entry.write(data);
                                    entry.viewerPane.setName(entry.name);
                                },
                                readOnly: false,
                            });

                            aceEditor.on('change', () => {
                                entry.viewerPane.setName("*" + entry.name);
                            });

                        } else {
                            console.log(`Unknown file type: ${file.type}`);
                        }
                    }
                }


                
            });
            
            
        })

        console.log(`Opened folder '${dirHandle.name}' and found ${this.entries.length} entries.`);
        
        const image_extensions = ["dcm", "tiff", "tif", "jpg", "jpeg", "png"];
        const image_files = this.entries.filter(entry => {
            const ext = entry.getExtension();
            return image_extensions.includes(ext);
        });

        console.log(`Found ${image_files.length} image files. Processing...`);


        // Extract images
        let images = this.extractImageFiles(image_files,(done, total) => {
            const progress = (done / total) * 100;
            console.log(`Loaded ${done} of ${total} images (${progress.toFixed(2)}%)`);
        });

        const stitchPane = new ContentPane();
        this.ui.stitchPane = stitchPane;
        stitchPane.setName("Grid Stitch Setup");
        this.paneCollection.addPane(stitchPane);

        this.stitchSetup = new GridStitchSetup(this);
        stitchPane.getElement().appendChild(this.stitchSetup.getElement());

        this.addToRenderQueue(this.stitchSetup);

        images = await images;

        console.log(`Extracted ${images.length} images.`);

        // Find stitch_config.json
        const config_file = this.entries.find(entry => entry.name === "stitch_config.json");
        if (!config_file) {
            console.log("No stitch_config.json found.");
            return;
        }

        const config = JSON.parse(await config_file.getText());
        console.log("Loaded stitch_config.json", config);

        const tiles = config.tile_paths.map(tile_path => {
            const tile = this.entries.find(entry => entry.name === tile_path);
            if (!tile) {
                throw new Error(`Tile not found: ${tile_path}`);
            }
            return tile;
        });

        console.log(`Found ${tiles.length} tiles.`);

        // Get offsets
        const offsets = config.tile_layout.map(offset => {
            let x = 0;
            let y = 0;
            let z = 0;
            let width = 1;
            let height = 1;
            let depth = 1;

            if (offset.length === 2) {
                [x, y] = offset;
            } else if (offset.length === 3) {
                [x, y, z] = offset;
            } else if (offset.length === 4) {
                [x, y, width, height] = offset;
            } else if (offset.length === 6) {
                [x, y, z, width, height, depth] = offset;
            } else {
                throw new Error("Invalid offset format.");
            }

            return {x, y, z, width, height, depth};
        });

        if (tiles.length !== offsets.length) {
            throw new Error("Number of tiles and offsets do not match.");
        }

        const pane = new ContentPane();
        pane.setName("Stitch Preview");
        this.paneCollection.addPane(pane);

        const viewer = new StitchVisualizer();
        viewer.setFuseMode(config.fuse_mode);

        this.stitchVisualizer = viewer;
        
        const tileImages = await Promise.all(tiles.map(tile => tile.imagePromise));

        pane.getElement().appendChild(viewer.getElement());

        this.addToRenderQueue(viewer);

        pane.on('close', () => {
            this.removeFromRenderQueue(viewer);
        });

        pane.on('select', () => {
            viewer.centerAndScale();
        });

        viewer.setImages(tileImages, offsets.map((offset)=>{
            return {
                x: Math.round(offset.x * tileImages[0].width / offset.width),
                y: Math.round(offset.y * tileImages[0].height / offset.height),
                z: Math.round(offset.z * tileImages[0].depth / offset.depth),
                width: tileImages[0].width,
                height: tileImages[0].height,
                depth: tileImages[0].depth
            }
        }), tiles.map(tile => tile.name));

        this.tileImages = tileImages;

        // Load output/align_values.json
        const output_folder = this.entries.find(entry => entry.name === "output");
        if (!output_folder) {
            console.log("No output folder found.");
            return;
        }

        console.log("Found output folder.", output_folder);
        
        const output_folder_entries = await FileUtils.getEntries(await this.fs.getDirectoryHandle("output"));
        const align_values_file = output_folder_entries.find(entry => entry.name === "align_values.json");
        if (!align_values_file) {
            console.log("No align_values.json found.");
            return;
        }

        const align_values = JSON.parse(await align_values_file.getText());

        console.log("Loaded align_values.json", align_values);

        const offsetsList = align_values.offsets;
        this.subgraphViewers = [];
        align_values.subgraphs.forEach(async (subgraph, index) => {
            const tileImages = await Promise.all(tiles.filter((tile, index) => subgraph.includes(index)).map(tile => tile.imagePromise));
            const offsets = offsetsList[index].map((offset,i) => {
                return {
                    x: Math.round(offset[0] || 0),
                    y: Math.round(offset[1] || 0),
                    z: Math.round(offset[2] || 0),
                    width: tileImages[i].width,
                    height: tileImages[i].height,
                    depth: tileImages[i].depth
                }
            });
           
            const pane = new ContentPane();
            pane.setName(`Subgraph ${index}`);
            this.paneCollection.addPane(pane);

            const viewer = new StitchVisualizer();
            viewer.setFuseMode(config.fuse_mode);
            pane.getElement().appendChild(viewer.getElement());
            this.addToRenderQueue(viewer);

            pane.on('close', () => {
                this.removeFromRenderQueue(viewer);
            });

            pane.on('select', () => {
                viewer.centerAndScale();
            });

            const names = subgraph.map(index => tiles[index].name);
            //console.log("Subgraph", tileImages, offsets, names);
            viewer.setImages(tileImages, offsets, names);

            console.log(`Loaded subgraph ${index}`);

            this.subgraphViewers.push(viewer);
        });
    }

    async extractImageFiles(image_files, callbackProgress) {
        const parser = new ParallelImageParser();
        let imgsPromises = parser.processImageFiles(image_files, (done, total) => {
            if (callbackProgress) callbackProgress(done, total);
        });

        imgsPromises.forEach((image, index) => {
            image_files[index].imagePromise = image;
        });

        const images = await Promise.all(imgsPromises);

        parser.close();

        return images;
    }

    displayImages() {
        this.images.forEach(image => {
            const viewer = new Viewer3DSliceWithControls();
            viewer.setImage(image);
            this.ui.imageContainer.appendChild(viewer.getElement());
            image.viewer = viewer; // Store reference to viewer in image
        });
    }
    
}