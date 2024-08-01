use fuse::{fuse_2d, fuse_3d, FuseMode};
use image::{read_dcm, read_tiff, save_as_dcm, Image2D, Image3D, Image3DFile};
use rayon::iter::{IntoParallelIterator, ParallelIterator};
use serde_json::*;
use std::path::{Path, PathBuf};
use stitch2d::IBox2D;
use stitch3d::IBox3D;

mod fuse;
mod image;
mod stitch2d;
mod stitch3d;

#[derive(PartialEq, Clone, Copy)]
pub enum StitchMode {
    TwoD,
    ThreeD,
}

fn main() {
    let args = std::env::args().collect::<Vec<_>>();

    if args.len() < 2 {
        println!("Usage: cmd config_file.json");
        return;
    }

    let config_path = Path::new(&args[1]);
    if !config_path.exists() {
        println!("Config file does not exist");
        return;
    }
    let mut config = read_config_file(config_path);
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "-o" => {
                i += 1;
                config.output_path = PathBuf::from(&args[i]);
            }
            "-no-fuse" => {
                config.no_fuse = true;
            }
            _ => {
                println!("Invalid argument: {}", args[i]);
                return;
            }
        }
        i += 1;
    }

    // Make output directory
    if !config.output_path.exists() {
        std::fs::create_dir_all(&config.output_path).unwrap();
    }

    match config.mode {
        StitchMode::TwoD => {
            stitch_2d(config);
        }
        StitchMode::ThreeD => {
            stitch_3d(config);
        }
    }
}

pub struct StitchConfig {
    pub version: String,
    pub mode: StitchMode,
    pub overlap_ratio: f32,
    pub correlation_threshold: f32,
    pub check_peaks: usize,
    pub dimension_mask: (bool, bool, bool),
    pub fuse_mode: FuseMode,
    pub no_fuse: bool,
    pub output_path: PathBuf,
    pub alignment_file: Option<PathBuf>,
    pub tile_paths: Vec<PathBuf>,
    pub tile_layout: Vec<IBox3D>,
}

impl StitchConfig {
    pub fn new() -> Self {
        StitchConfig {
            version: "1.0".to_string(),
            mode: StitchMode::TwoD,
            overlap_ratio: 0.2,
            correlation_threshold: 0.3,
            check_peaks: 5,
            dimension_mask: (true, true, true),
            fuse_mode: FuseMode::Average,
            no_fuse: false,
            output_path: PathBuf::new(),
            alignment_file: None,
            tile_paths: vec![],
            tile_layout: vec![],
        }
    }
}

pub fn read_config_file(path: &Path) -> StitchConfig {
    let base_path = path.parent();
    let json_str = std::fs::read_to_string(path).unwrap();

    let mut config = StitchConfig::new();

    let json: Value = serde_json::from_str(&json_str).unwrap();

    // Check version
    if !json.get("version").is_none() {
        config.version = json["version"].as_str().unwrap().to_string();
    }

    // Get 3d or 2d
    if json.get("mode").is_none() {
        panic!("No mode specified");
    }

    let mode = json["mode"].as_str().unwrap();
    match mode {
        "2d" => {
            config.mode = StitchMode::TwoD;
        }
        "3d" => {
            config.mode = StitchMode::ThreeD;
        }
        _ => {
            panic!("Invalid mode");
        }
    }

    // Check overlap ratio
    if !json.get("overlap_ratio").is_none() {
        config.overlap_ratio = json["overlap_ratio"].as_f64().unwrap() as f32;
    }

    // Check correlation threshold
    if !json.get("correlation_threshold").is_none() {
        config.correlation_threshold = json["correlation_threshold"].as_f64().unwrap() as f32;
    }

    // Check check peaks
    if !json.get("check_peaks").is_none() {
        config.check_peaks = json["check_peaks"].as_u64().unwrap() as usize;
    }

    // Check dimension mask
    if !json.get("dimension_mask").is_none() {
        let mask = json["dimension_mask"].as_array().unwrap();
        let mut x = true;
        let mut y = true;
        let mut z = true;
        if mask.len() == 2 {
            x = mask[0].as_bool().unwrap();
            y = mask[1].as_bool().unwrap();
        } else if mask.len() == 3 {
            x = mask[0].as_bool().unwrap();
            y = mask[1].as_bool().unwrap();
            z = mask[2].as_bool().unwrap();
        } else {
            println!("Invalid dimension mask... using default");
        }

        config.dimension_mask = (x, y, z);
    }

    // Check fuse mode
    if !json.get("fuse_mode").is_none() {
        let mode = json["fuse_mode"].as_str().unwrap();
        match mode {
            "average" => {
                config.fuse_mode = FuseMode::Average;
            }
            "max" => {
                config.fuse_mode = FuseMode::Max;
            }
            "min" => {
                config.fuse_mode = FuseMode::Min;
            }
            "overwrite" => {
                config.fuse_mode = FuseMode::Overwrite;
            }
            _ => {
                panic!("Invalid fuse mode");
            }
        }
    }

    // Check no fuse
    if !json.get("no_fuse").is_none() {
        config.no_fuse = json["no_fuse"].as_bool().unwrap();
    }

    // Check output path
    if !json.get("output_path").is_none() {
        config.output_path = PathBuf::from(json["output_path"].as_str().unwrap());

        if !config.output_path.is_absolute() {
            if base_path.is_none() {
                panic!("Invalid base path");
            }

            config.output_path = base_path.unwrap().join(&config.output_path);
        }
    } else {
        if base_path.is_none() {
            panic!("Invalid base path");
        }
        config.output_path = base_path.unwrap().join("output");
    }

    // Check alignment file
    if !json.get("alignment_file").is_none() {
        let mut path = PathBuf::from(json["alignment_file"].as_str().unwrap());
        if !path.is_absolute() {
            if base_path.is_none() {
                panic!("Invalid base path");
            }

            path = base_path.unwrap().join(&path);
        }
        config.alignment_file = Some(path);
    }

    // Check tile paths
    if json.get("tile_paths").is_none() {
        panic!("No tile paths specified");
    }

    if !json.get("tiles").is_none() {
        let tiles = json["tiles"].as_array().unwrap();
        for tile in tiles {
            let tile = tile.as_object().unwrap();
            let mut path = PathBuf::from(tile["path"].as_str().unwrap());
            if !path.is_absolute() {
                if base_path.is_none() {
                    panic!("Invalid base path");
                }

                path = base_path.unwrap().join(&path);
            }
            let mut temp = IBox3D::new(0, 0, 0, 1, 1, 1);
            
            if !tile.get("box").is_none() {
                let box_arr = tile["box"].as_array().unwrap();
                if box_arr.len() == 2 {
                    temp.x = box_arr[0].as_i64().unwrap();
                    temp.y = box_arr[1].as_i64().unwrap();
                } else if box_arr.len() == 3 {
                    temp.x = box_arr[0].as_i64().unwrap();
                    temp.y = box_arr[1].as_i64().unwrap();
                    temp.z = box_arr[2].as_i64().unwrap();
                } else if box_arr.len() == 4 {
                    temp.x = box_arr[0].as_i64().unwrap();
                    temp.y = box_arr[1].as_i64().unwrap();
                    temp.width = box_arr[2].as_i64().unwrap();
                    temp.height = box_arr[3].as_i64().unwrap();
                } else if box_arr.len() == 6 {
                    temp.x = box_arr[0].as_i64().unwrap();
                    temp.y = box_arr[1].as_i64().unwrap();
                    temp.z = box_arr[2].as_i64().unwrap();
                    temp.width = box_arr[3].as_i64().unwrap();
                    temp.height = box_arr[4].as_i64().unwrap();
                    temp.depth = box_arr[5].as_i64().unwrap();
                } else {
                    panic!("Invalid tile layout");
                }
            } else {
                let x = tile.get("x").unwrap().as_i64().unwrap();
                let y = tile.get("y").unwrap().as_i64().unwrap();
                if !tile.get("z").is_none() {
                    let z = tile.get("z").unwrap().as_i64().unwrap();
                    temp.x = x;
                    temp.y = y;
                    temp.z = z;
                } else {
                    temp.x = x;
                    temp.y = y;
                }

                if !tile.get("width").is_none() {
                    temp.width = tile.get("width").unwrap().as_i64().unwrap();
                }

                if !tile.get("height").is_none() {
                    temp.height = tile.get("height").unwrap().as_i64().unwrap();
                }

                if !tile.get("depth").is_none() {
                    temp.depth = tile.get("depth").unwrap().as_i64().unwrap();
                }
            }

            config.tile_paths.push(path);
            config.tile_layout.push(temp);
        }
    } else {
        let tile_paths = json["tile_paths"].as_array().unwrap();
        for tile_path in tile_paths {
            let mut path = PathBuf::from(tile_path.as_str().unwrap());
            if !path.is_absolute() {
                if base_path.is_none() {
                    panic!("Invalid base path");
                }

                path = base_path.unwrap().join(&path);
            }
            config.tile_paths.push(path);
        }

        // Check tile layout
        if json.get("tile_layout").is_none() {
            panic!("No tile layout specified");
        }

        let tile_layout = json["tile_layout"].as_array().unwrap();
        for layout in tile_layout {
            let arr = layout.as_array().unwrap();
            let mut temp = IBox3D::new(0, 0, 0, 1, 1, 1);
            if arr.len() == 2 {
                temp.x = arr[0].as_i64().unwrap();
                temp.y = arr[1].as_i64().unwrap();
            } else if arr.len() == 3 {
                temp.x = arr[0].as_i64().unwrap();
                temp.y = arr[1].as_i64().unwrap();
                temp.z = arr[2].as_i64().unwrap();
            } else if arr.len() == 4 {
                temp.x = arr[0].as_i64().unwrap();
                temp.y = arr[1].as_i64().unwrap();
                temp.width = arr[2].as_i64().unwrap();
                temp.height = arr[3].as_i64().unwrap();
            } else if arr.len() == 6 {
                temp.x = arr[0].as_i64().unwrap();
                temp.y = arr[1].as_i64().unwrap();
                temp.z = arr[2].as_i64().unwrap();
                temp.width = arr[3].as_i64().unwrap();
                temp.height = arr[4].as_i64().unwrap();
                temp.depth = arr[5].as_i64().unwrap();
            } else {
                panic!("Invalid tile layout");
            }

            config.tile_layout.push(temp);
        }

        if config.tile_paths.len() != config.tile_layout.len() {
            panic!("Tile paths and layout do not match length!");
        }
    }

    config
}

fn stitch_3d(
    config: StitchConfig,
) {
    println!("Reading files...");
    let start = std::time::Instant::now();
    let images = config
        .tile_paths
        .into_par_iter()
        .map(|path| {
            let mut imagefile = Image3DFile::new(0, 0, 0, path.to_path_buf());
            imagefile.load_dims();

            imagefile
        })
        .collect::<Vec<_>>();

    println!("Time to read files: {:?}", start.elapsed());

    let mut stitched_result = None;

    if !config.alignment_file.is_none() && config.alignment_file.clone().unwrap().exists() {
        let alignment_file = config.alignment_file.unwrap();
        let json_str = std::fs::read_to_string(alignment_file).unwrap();
        let res = serde_json::from_str(&json_str).unwrap();
        println!("Alignment file loaded");
        stitched_result = Some(res);
    }

    if stitched_result.is_none() {
        println!("Aligning images...");
        let start = std::time::Instant::now();
        let result = stitch3d::stitch(
            &images,
            &config.tile_layout,
            config.overlap_ratio,
            config.check_peaks,
            config.correlation_threshold,
            config.dimension_mask,
        );
        println!("Time to find alignment: {:?}", start.elapsed());
        stitched_result = Some(result);
    }

    let stitched_result = stitched_result.unwrap();

    let json = json!(stitched_result);
    let json_str = json.to_string();
    let json_path = config.output_path.join("align_values.json");

    std::fs::write(json_path, json_str).unwrap();

    if config.no_fuse {
        return;
    }

    println!("Fusing images...");
    let start = std::time::Instant::now();

    stitched_result
        .offsets
        .iter()
        .enumerate()
        .for_each(|(i, offset)| {
            let fused_image = fuse_3d(
                &images,
                &stitched_result.subgraphs[i],
                offset,
                config.fuse_mode,
            );
            let output_file = format!("stitched_{}.dcm", i);
            let buf = config.output_path.join(output_file);
            let path = buf.as_path();
            save_as_dcm(path, &fused_image);
        });

    println!("Time to fuse images: {:?}", start.elapsed());
}

fn stitch_2d(
    config: StitchConfig,
) {
    println!("Reading files...");
    let start = std::time::Instant::now();
    let images = config
        .tile_paths
        .into_par_iter()
        .map(|path| {
            let ext = path.extension().unwrap().to_str().unwrap();
            let image = if ext == "tiff" {
                read_tiff(path.as_path())
            } else if ext == "dcm" {
                read_dcm(path.as_path())
            } else {
                panic!("Invalid file format");
            };

            let frame = image.get_frame(0);
            Image2D {
                data: frame.data.to_vec(),
                width: frame.width,
                height: frame.height,
            }
        })
        .collect::<Vec<_>>();

    println!("Time to read files: {:?}", start.elapsed());

    let mut stitched_result = None;
    
    if !config.alignment_file.is_none() && config.alignment_file.clone().unwrap().exists() {
        let alignment_file = config.alignment_file.unwrap();
        let json_str = std::fs::read_to_string(alignment_file).unwrap();
        let res = serde_json::from_str(&json_str).unwrap();
        println!("Alignment file loaded");
        stitched_result = Some(res);
    }

    if stitched_result.is_none() {
        println!("Aligning images...");
        let start = std::time::Instant::now();
        let dim_mask = (config.dimension_mask.0, config.dimension_mask.1);
        let tile_layout = config
            .tile_layout
            .iter()
            .map(|layout| IBox2D::new(layout.x, layout.y, layout.width, layout.height))
            .collect::<Vec<_>>();
        let result = stitch2d::stitch(
            &images,
            &tile_layout,
            config.overlap_ratio,
            config.check_peaks,
            config.correlation_threshold,
            dim_mask,
        );
        println!("Time to find alignment: {:?}", start.elapsed());
        stitched_result = Some(result);
    }

    let stitched_result = stitched_result.unwrap();

    let json = json!(stitched_result);
    let json_str = json.to_string();
    let json_path = config.output_path.join("align_values.json");

    std::fs::write(json_path, json_str).unwrap();

    if config.no_fuse {
        return;
    }

    println!("Fusing images...");
    let start = std::time::Instant::now();

    stitched_result
        .offsets
        .iter()
        .enumerate()
        .for_each(|(i, offset)| {
            let fused_image = fuse_2d(
                &images,
                &stitched_result.subgraphs[i],
                offset,
                config.fuse_mode,
            );
            let output_file = format!("stitched_{}.dcm", i);
            let buf = config.output_path.join(output_file);
            let path = buf.as_path();
            let image3d = Image3D {
                data: fused_image.data,
                width: fused_image.width,
                height: fused_image.height,
                depth: 1,
            };
            save_as_dcm(path, &image3d);
        });

    println!("Time to fuse images: {:?}", start.elapsed());
}
