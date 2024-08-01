use rayon::prelude::*;

use crate::image::*;

const DO_SUBPIXEL: bool = true;

#[derive(PartialEq, Clone, Copy, Debug)]
pub enum FuseMode {
    Average,
    Min,
    Max,
    Overwrite,
}

pub fn fuse_2d(
    images: &[Image2D],
    subgraph_indexes: &[usize],
    offsets: &[(f32, f32)],
    mode: FuseMode,
) -> Image2D {
    let num_images: usize = subgraph_indexes.len();

    // Find width and height and depth of new image
    let mut width = 0;
    let mut height = 0;

    let mut min = 0.0;
    let mut max = 0.0;

    for i in 0..num_images {
        let image = &images[subgraph_indexes[i]];
        let new_width = image.width as i64 + (offsets[i].0.ceil()) as i64;
        let new_height = image.height as i64 + (offsets[i].1.ceil()) as i64;

        width = width.max(new_width);
        height = height.max(new_height);
        min = image.min.min(min);
        max = image.max.max(max);
    }

    println!("Fusing image {} x {}", width, height);
    let mut new_image: Vec<f32> = vec![0.0; (width * height) as usize];
    let mut new_image_counts: Vec<u8> = vec![];
    if mode == FuseMode::Average {
        new_image_counts = vec![0; (width * height) as usize];
    }

    for i in 0..num_images {
        let image = &images[subgraph_indexes[i]];
        let offset = offsets[i];
        let offset_i = (offset.0.floor(), offset.1.floor());
        let offset_f = (offset.0 - offset_i.0, offset.1 - offset_i.1);
        let offset_i = (offset_i.0 as i64, offset_i.1 as i64);
        let offset_fi = (1.0 - offset_f.0, 1.0 - offset_f.1);

        let start_x = offset_i.0.max(0);
        let start_y = offset_i.1.max(0);
        let end_x = (offset_i.0 + image.width as i64).min(width as i64);
        let end_y = (offset_i.1 + image.height as i64).min(height as i64);

        for y in start_y..end_y {
            for x in start_x..end_x {
                let src_x = (x - offset_i.0) as usize;
                let src_y = (y - offset_i.1) as usize;

                let mut val = 0.0;
                //let mut count = 1;

                if DO_SUBPIXEL {
                    val += image.get(src_x, src_y) * offset_fi.0 * offset_fi.1;

                    let prev_x = if src_x > 0 {
                        src_x - 1
                    } else {
                        1.min(width - 1) as usize
                    };
                    let prev_y = if src_y > 0 {
                        src_y - 1
                    } else {
                        1.min(height - 1) as usize
                    };
                    val += image.get(prev_x, src_y) * offset_f.0 * offset_fi.1;
                    val += image.get(src_x, prev_y) * offset_fi.0 * offset_f.1;
                    val += image.get(prev_x, prev_y) * offset_f.0 * offset_f.1;
                } else {
                    val = image.get(src_x, src_y);
                }
                let index = (x + y * width) as usize;

                match mode {
                    FuseMode::Average => {
                        new_image[index] += val;
                        new_image_counts[index] += 1;
                    }
                    FuseMode::Max => {
                        new_image[index] = new_image[index].max(val);
                    }
                    FuseMode::Min => {
                        new_image[index] = new_image[index].min(val);
                    }
                    FuseMode::Overwrite => {
                        new_image[index] = val;
                    }
                }
            }
        }
    }

    if mode == FuseMode::Average {
        for i in 0..(width * height) as usize {
            if new_image_counts[i] > 0 {
                new_image[i] /= new_image_counts[i] as f32;
            }
        }
    }

    println!("Image fused!");

    Image2D {
        width: width as usize,
        height: height as usize,
        data: new_image,
        min,
        max,
    }
}

pub fn fuse_3d(
    images: &[Image3DFile],
    subgraph_indexes: &[usize],
    offsets: &[(f32, f32, f32)],
    mode: FuseMode,
) -> Image3D8 {
    let num_images: usize = subgraph_indexes.len();

    // Find width and height and depth of new image
    let mut width = 0;
    let mut height = 0;
    let mut depth = 0;
    let mut min = 0.0;
    let mut max = 0.0;

    for i in 0..num_images {
        let image = &images[subgraph_indexes[i]];
        let new_width = image.width as i64 + (offsets[i].0.ceil()) as i64;
        let new_height = image.height as i64 + (offsets[i].1.ceil()) as i64;
        let new_depth = image.depth as i64 + (offsets[i].2.ceil()) as i64;

        if new_width > width {
            width = new_width;
        }

        if new_height > height {
            height = new_height;
        }

        if new_depth > depth {
            depth = new_depth;
        }

        min = image.min.min(min);
        max = image.max.max(max);
    }

    println!("Fusing image {} x {} x {}", width, height, depth);
    let mut new_image_counts: Vec<u8> = vec![];
    if mode == FuseMode::Average {
        new_image_counts = vec![0; (width * height * depth) as usize];

        for i in 0..num_images {
            let image = &images[subgraph_indexes[i]];
            let offset = offsets[i];
            let offset_i = (offset.0.floor(), offset.1.floor(), offset.2.floor());
            let offset_i = (offset_i.0 as i64, offset_i.1 as i64, offset_i.2 as i64);

            let start_x = offset_i.0.max(0);
            let start_y = offset_i.1.max(0);
            let start_z = offset_i.2.max(0);
            let end_x = (offset_i.0 + image.width as i64).min(width as i64);
            let end_y = (offset_i.1 + image.height as i64).min(height as i64);
            let end_z = (offset_i.2 + image.depth as i64).min(depth as i64);

            for z in start_z..end_z {
                for y in start_y..end_y {
                    for x in start_x..end_x {
                        let index = (x + y * width + z * width * height) as usize;
                        new_image_counts[index] += 1;
                    }
                }
            }
        }
    }


    let mut new_image: Vec<u8> = vec![0; (width * height * depth) as usize];
    for i in 0..num_images {
        let imgfile = &images[subgraph_indexes[i]];
        let image = imgfile.get_image();

        let offset = offsets[i];
        let offset_i = (offset.0.floor(), offset.1.floor(), offset.2.floor());
        let offset_f = (
            offset.0 - offset_i.0,
            offset.1 - offset_i.1,
            offset.2 - offset_i.2,
        );
        let offset_i = (offset_i.0 as i64, offset_i.1 as i64, offset_i.2 as i64);
        let offset_fi = (1.0 - offset_f.0, 1.0 - offset_f.1, 1.0 - offset_f.2);

        let start_x = offset_i.0.max(0);
        let start_y = offset_i.1.max(0);
        let start_z = offset_i.2.max(0);
        let end_x = (offset_i.0 + image.width as i64).min(width as i64);
        let end_y = (offset_i.1 + image.height as i64).min(height as i64);
        let end_z = (offset_i.2 + image.depth as i64).min(depth as i64);

        for z in start_z..end_z {
            for y in start_y..end_y {
                for x in start_x..end_x {
                    let src_x = (x - offset_i.0) as usize;
                    let src_y = (y - offset_i.1) as usize;
                    let src_z = (z - offset_i.2) as usize;

                    let mut val = 0.0;
                    if DO_SUBPIXEL {
                        val += image.get(src_x, src_y, src_z)
                            * offset_fi.0
                            * offset_fi.1
                            * offset_fi.2;

                        let prev_x = if src_x > 0 {
                            src_x - 1
                        } else {
                            1.min(width - 1) as usize
                        };
                        let prev_y = if src_y > 0 {
                            src_y - 1
                        } else {
                            1.min(height - 1) as usize
                        };
                        let prev_z = if src_z > 0 {
                            src_z - 1
                        } else {
                            1.min(depth - 1) as usize
                        };
                        val += image.get(prev_x, src_y, src_z)
                            * offset_f.0
                            * offset_fi.1
                            * offset_fi.2;
                        val += image.get(src_x, prev_y, src_z)
                            * offset_fi.0
                            * offset_f.1
                            * offset_fi.2;
                        val += image.get(src_x, src_y, prev_z)
                            * offset_fi.0
                            * offset_fi.1
                            * offset_f.2;
                        val += image.get(prev_x, prev_y, src_z)
                            * offset_f.0
                            * offset_f.1
                            * offset_fi.2;
                        val += image.get(prev_x, src_y, prev_z)
                            * offset_f.0
                            * offset_fi.1
                            * offset_f.2;
                        val += image.get(src_x, prev_y, prev_z)
                            * offset_fi.0
                            * offset_f.1
                            * offset_f.2;
                        val += image.get(prev_x, prev_y, prev_z)
                            * offset_f.0
                            * offset_f.1
                            * offset_f.2;
                    } else {
                        val = image.get(src_x, src_y, src_z);
                    }

                    let index = (x + y * width + z * width * height) as usize;

                    let val = ((val - min) / (max - min) * 255.0).clamp(0.0, 255.0) as u8;
                    match mode {
                        FuseMode::Average => {
                            new_image[index] = new_image[index].saturating_add(val / new_image_counts[index]);
                        }
                        FuseMode::Max => {
                            new_image[index] = new_image[index].max(val);
                        }
                        FuseMode::Min => {
                            new_image[index] = new_image[index].min(val);
                        }
                        FuseMode::Overwrite => {
                            new_image[index] = val;
                        }
                    }
                }
            }
        }

        println!("Image {} stitched", i + 1);
        drop(image);
    }

    println!("Image fused!");

    Image3D8 {
        width: width as usize,
        height: height as usize,
        depth: depth as usize,
        data: new_image
    }
}
