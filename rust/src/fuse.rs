use rayon::prelude::*;

use crate::image::*;

const DO_SUBPIXEL: bool = true;

#[derive(PartialEq, Clone, Copy, Debug)]
pub enum FuseMode {
    Linear,
    Average,
    Min,
    Max,
    Overwrite,
    OverwritePrioritizeCenter,
}

pub fn get_linear_weight_3d(
    dim: (usize, usize, usize),
    offset: (usize, usize, usize),
    alpha: f32,
) -> f32 {
    let mut min_distance = 1.0;
    min_distance *= (offset.0.min(dim.0 - offset.0 - 1) + 1) as f32;
    min_distance *= (offset.1.min(dim.1 - offset.1 - 1) + 1) as f32;
    min_distance *= (offset.2.min(dim.2 - offset.2 - 1) + 1) as f32;

    min_distance += 1.0;
    return min_distance.powf(alpha);
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
    let mut new_image_weights: Vec<f32> = vec![];
    if mode == FuseMode::Average {
        new_image_counts = vec![0; (width * height) as usize];
    } else if mode == FuseMode::Linear || mode == FuseMode::OverwritePrioritizeCenter {
        new_image_weights = vec![0.0; (width * height) as usize];
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
                    FuseMode::Linear => {
                        let weight = get_linear_weight_3d(
                            (image.width, image.height, 1),
                            (src_x, src_y, 0),
                            1.5,
                        );
                        new_image[index] += val * weight;
                        new_image_weights[index] += weight;
                    }
                    FuseMode::OverwritePrioritizeCenter => {
                        let weight = get_linear_weight_3d(
                            (image.width, image.height, 1),
                            (src_x, src_y, 0),
                            1.5,
                        );

                        if weight > new_image_weights[index] {
                            new_image[index] = val;
                            new_image_weights[index] = weight;
                        }
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
    } else if mode == FuseMode::Linear {
        for i in 0..(width * height) as usize {
            if new_image_weights[i] > 0.0 {
                new_image[i] /= new_image_weights[i];
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

pub fn calc_iter_bounds(
    tile_pos: (f32, f32, f32),
    tile_dim: (usize, usize, usize),
    dim: (usize, usize, usize),
) -> (
    i64,
    i64,
    i64,
    i64,
    i64,
    i64,
    (i64, i64, i64),
    (f32, f32, f32),
) {
    let offset_i = (tile_pos.0.floor(), tile_pos.1.floor(), tile_pos.2.floor());
    let offset_f = (
        tile_pos.0 - offset_i.0,
        tile_pos.1 - offset_i.1,
        tile_pos.2 - offset_i.2,
    );

    let offset_i = (offset_i.0 as i64, offset_i.1 as i64, offset_i.2 as i64);
    // let offset_fi = (1.0 - offset_f.0, 1.0 - offset_f.1, 1.0 - offset_f.2);

    let start_x = offset_i.0.max(0);
    let start_y = offset_i.1.max(0);
    let start_z = offset_i.2.max(0);
    let end_x = (offset_i.0 + tile_dim.0 as i64).min(dim.0 as i64);
    let end_y = (offset_i.1 + tile_dim.1 as i64).min(dim.1 as i64);
    let end_z = (offset_i.2 + tile_dim.2 as i64).min(dim.2 as i64);

    (
        start_x, start_y, start_z, end_x, end_y, end_z, offset_i, offset_f,
    )
}

pub fn calc_new_dim(
    images: &[Image3DFile],
    subgraph_indexes: &[usize],
    offsets: &[(f32, f32, f32)],
) -> (usize, usize, usize, f32, f32) {
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

    (width as usize, height as usize, depth as usize, min, max)
}

pub fn get_val(src_pos: (usize, usize, usize), offset_f: (f32, f32, f32), image: &Image3D) -> f32 {
    let src_x = src_pos.0;
    let src_y = src_pos.1;
    let src_z = src_pos.2;
    let offset_fi = (1.0 - offset_f.0, 1.0 - offset_f.1, 1.0 - offset_f.2);
    let mut val = 0.0;
    if DO_SUBPIXEL {
        val += image.get(src_x, src_y, src_z) * offset_fi.0 * offset_fi.1 * offset_fi.2;

        let prev_x = if src_x > 0 {
            src_x - 1
        } else {
            1.min(image.width - 1) as usize
        };
        let prev_y = if src_y > 0 {
            src_y - 1
        } else {
            1.min(image.height - 1) as usize
        };
        let prev_z = if src_z > 0 {
            src_z - 1
        } else {
            1.min(image.depth - 1) as usize
        };
        val += image.get(prev_x, src_y, src_z) * offset_f.0 * offset_fi.1 * offset_fi.2;
        val += image.get(src_x, prev_y, src_z) * offset_fi.0 * offset_f.1 * offset_fi.2;
        val += image.get(src_x, src_y, prev_z) * offset_fi.0 * offset_fi.1 * offset_f.2;
        val += image.get(prev_x, prev_y, src_z) * offset_f.0 * offset_f.1 * offset_fi.2;
        val += image.get(prev_x, src_y, prev_z) * offset_f.0 * offset_fi.1 * offset_f.2;
        val += image.get(src_x, prev_y, prev_z) * offset_fi.0 * offset_f.1 * offset_f.2;
        val += image.get(prev_x, prev_y, prev_z) * offset_f.0 * offset_f.1 * offset_f.2;
    } else {
        val = image.get(src_x, src_y, src_z);
    }

    val
}
pub fn fuse_3d(
    images: &[Image3DFile],
    subgraph_indexes: &[usize],
    offsets: &[(f32, f32, f32)],
    mode: FuseMode,
) -> Image3D8 {
    let num_images: usize = subgraph_indexes.len();
    let (width, height, depth, min, max) = calc_new_dim(images, subgraph_indexes, offsets);

    let alpha = 1.5;
    println!("Fusing image {} x {} x {}", width, height, depth);
    let mut new_image_counts: Vec<u8> = vec![];
    let mut new_image_weights: Vec<f32> = vec![];
    if mode == FuseMode::Average {
        new_image_counts = vec![0; (width * height * depth) as usize];

        for i in 0..num_images {
            let image = &images[subgraph_indexes[i]];
            let (start_x, start_y, start_z, end_x, end_y, end_z, _offset_i, _offset_f) =
                calc_iter_bounds(
                    offsets[i],
                    (image.width, image.height, image.depth),
                    (width, height, depth),
                );

            for z in start_z..end_z {
                for y in start_y..end_y {
                    for x in start_x..end_x {
                        let index =
                            (x + y * width as i64 + z * width as i64 * height as i64) as usize;
                        new_image_counts[index] += 1;
                    }
                }
            }
        }

        println!("Image counts calculated");
    } else if mode == FuseMode::Linear {
        new_image_weights = vec![0.0; (width * height * depth) as usize];
        new_image_weights
            .par_chunks_exact_mut(width * height)
            .enumerate()
            .for_each(|(z, chunk)| {
                for i in 0..num_images {
                    let image = &images[subgraph_indexes[i]];
                    let (start_x, start_y, start_z, end_x, end_y, end_z, offset_i, _offset_f) =
                        calc_iter_bounds(
                            offsets[i],
                            (image.width, image.height, image.depth),
                            (width, height, depth),
                        );

                    if (z as i64) < start_z || (z as i64) >= end_z {
                        continue;
                    }

                    for y in start_y..end_y {
                        for x in start_x..end_x {
                            let index = (x + y * width as i64) as usize;
                            chunk[index] += get_linear_weight_3d(
                                (image.width, image.height, image.depth),
                                (
                                    (x - offset_i.0) as usize,
                                    (y - offset_i.1) as usize,
                                    (z as i64 - offset_i.2) as usize,
                                ),
                                alpha,
                            );
                        }
                    }
                }
            });

        println!("Image weights calculated");
    } else if FuseMode::OverwritePrioritizeCenter == mode {
        new_image_weights = vec![0.0; (width * height * depth) as usize];
    }

    let default_value = match mode {
        FuseMode::Average => 0,
        FuseMode::Max => 0,
        FuseMode::Min => 255,
        FuseMode::Overwrite => 0,
        FuseMode::Linear => 0,
        FuseMode::OverwritePrioritizeCenter => 0,
    };
    let mut new_image: Vec<u8> = vec![default_value; (width * height * depth) as usize];
    for i in 0..num_images {
        let imgfile = &images[subgraph_indexes[i]];
        let image = imgfile.get_image();
        let (start_x, start_y, start_z, end_x, end_y, end_z, offset_i, offset_f) = calc_iter_bounds(
            offsets[i],
            (image.width, image.height, image.depth),
            (width, height, depth),
        );

        match mode {
            FuseMode::Average => {
                new_image[start_z as usize * width * height..end_z as usize * width * height]
                    .par_chunks_mut(width * height)
                    .enumerate()
                    .for_each(|(z, chunk)| {
                        let z = z as i64 + start_z;
                        for y in start_y..end_y {
                            for x in start_x..end_x {
                                let index = (x + y * width as i64) as usize;
                                let val = get_val(
                                    (
                                        (x - offset_i.0) as usize,
                                        (y - offset_i.1) as usize,
                                        (z as i64 - offset_i.2) as usize,
                                    ),
                                    offset_f,
                                    &image,
                                );
                                let val =
                                    ((val - min) / (max - min) * 255.0).clamp(0.0, 255.0) as u8;
                                let cindex = (x
                                    + y * width as i64
                                    + z as i64 * width as i64 * height as i64)
                                    as usize;
                                chunk[index] =
                                    chunk[index].saturating_add(val / new_image_counts[cindex]);
                            }
                        }
                    });
            }
            FuseMode::Max => {
                new_image[start_z as usize * width * height..end_z as usize * width * height]
                    .par_chunks_mut(width * height)
                    .enumerate()
                    .for_each(|(z, chunk)| {
                        let z = z as i64 + start_z;
                        for y in start_y..end_y {
                            for x in start_x..end_x {
                                let index = (x + y * width as i64) as usize;
                                let val = get_val(
                                    (
                                        (x - offset_i.0) as usize,
                                        (y - offset_i.1) as usize,
                                        (z as i64 - offset_i.2) as usize,
                                    ),
                                    offset_f,
                                    &image,
                                );
                                let val =
                                    ((val - min) / (max - min) * 255.0).clamp(0.0, 255.0) as u8;
                                chunk[index] = chunk[index].max(val);
                            }
                        }
                    });
            }
            FuseMode::Min => {
                new_image[start_z as usize * width * height..end_z as usize * width * height]
                    .par_chunks_mut(width * height)
                    .enumerate()
                    .for_each(|(z, chunk)| {
                        let z = z as i64 + start_z;
                        for y in start_y..end_y {
                            for x in start_x..end_x {
                                let index = (x + y * width as i64) as usize;
                                let val = get_val(
                                    (
                                        (x - offset_i.0) as usize,
                                        (y - offset_i.1) as usize,
                                        (z as i64 - offset_i.2) as usize,
                                    ),
                                    offset_f,
                                    &image,
                                );
                                let val =
                                    ((val - min) / (max - min) * 255.0).clamp(0.0, 255.0) as u8;
                                chunk[index] = chunk[index].min(val);
                            }
                        }
                    });
            }
            FuseMode::Overwrite => {
                new_image[start_z as usize * width * height..end_z as usize * width * height]
                    .par_chunks_mut(width * height)
                    .enumerate()
                    .for_each(|(z, chunk)| {
                        let z = z as i64 + start_z;
                        for y in start_y..end_y {
                            for x in start_x..end_x {
                                let index = (x + y * width as i64) as usize;
                                let val = get_val(
                                    (
                                        (x - offset_i.0) as usize,
                                        (y - offset_i.1) as usize,
                                        (z as i64 - offset_i.2) as usize,
                                    ),
                                    offset_f,
                                    &image,
                                );
                                let val =
                                    ((val - min) / (max - min) * 255.0).clamp(0.0, 255.0) as u8;
                                chunk[index] = val;
                            }
                        }
                    });
            }
            FuseMode::Linear => {
                new_image[start_z as usize * width * height..end_z as usize * width * height]
                    .par_chunks_mut(width * height)
                    .zip(new_image_weights[start_z as usize * width * height..end_z as usize * width * height].par_chunks(width * height))
                    .enumerate()
                    .for_each(|(z, (chunk, weight_chunk))| {
                        let z = z as i64 + start_z;
                        for y in start_y..end_y {
                            for x in start_x..end_x {
                                let index = (x + y * width as i64) as usize;
                                let val = get_val(
                                    (
                                        (x - offset_i.0) as usize,
                                        (y - offset_i.1) as usize,
                                        (z as i64 - offset_i.2) as usize,
                                    ),
                                    offset_f,
                                    &image,
                                );
                                let val =
                                    ((val - min) / (max - min) * 255.0).clamp(0.0, 255.0) as u8;
                                chunk[index] = chunk[index].saturating_add(
                                    (val as f32
                                        * get_linear_weight_3d(
                                            (image.width, image.height, image.depth),
                                            (
                                                (x - offset_i.0) as usize,
                                                (y - offset_i.1) as usize,
                                                (z as i64 - offset_i.2) as usize,
                                            ),
                                            alpha,
                                        )
                                        / weight_chunk[index])
                                        as u8,
                                );
                            }
                        }
                    });
            }
            FuseMode::OverwritePrioritizeCenter => {
                new_image[start_z as usize * width * height..end_z as usize * width * height]
                    .par_chunks_mut(width * height)
                    .zip(new_image_weights[start_z as usize * width * height..end_z as usize * width * height].par_chunks_mut(width * height))
                    .enumerate()
                    .for_each(|(z, (chunk, weight_chunk))| {
                        let z = z as i64 + start_z;
                        for y in start_y..end_y {
                            for x in start_x..end_x {
                                let index = (x + y * width as i64) as usize;
                                let val = get_val(
                                    (
                                        (x - offset_i.0) as usize,
                                        (y - offset_i.1) as usize,
                                        (z as i64 - offset_i.2) as usize,
                                    ),
                                    offset_f,
                                    &image,
                                );
                                let val =
                                    ((val - min) / (max - min) * 255.0).clamp(0.0, 255.0) as u8;
                                let weight = get_linear_weight_3d(
                                    (image.width, image.height, image.depth),
                                    (
                                        (x - offset_i.0) as usize,
                                        (y - offset_i.1) as usize,
                                        (z as i64 - offset_i.2) as usize,
                                    ),
                                    alpha,
                                );
                                if weight > weight_chunk[index] {
                                    chunk[index] = val;
                                    weight_chunk[index] = weight;
                                }
                            }
                        }
                    });
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
        data: new_image,
    }
}
