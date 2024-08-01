use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use rayon::prelude::*;
use rustfft::{num_complex::Complex, num_traits::Zero, FftNum, FftPlanner};
use transpose::transpose;

use crate::image::{Image3D, Image3DFile};

#[derive(Debug)]
pub struct IBox3D {
    pub x: i64,
    pub y: i64,
    pub z: i64,
    pub width: i64,
    pub height: i64,
    pub depth: i64,
}

impl IBox3D {
    pub fn new(x: i64, y: i64, z: i64, width: i64, height: i64, depth: i64) -> IBox3D {
        IBox3D {
            x,
            y,
            z,
            width,
            height,
            depth,
        }
    }
    pub fn is_overlapping(
        self: &IBox3D,
        other: &IBox3D,
    ) -> bool {
        let min_x = self.x;
        let max_x = self.x + self.width;
        let min_y = self.y;
        let max_y = self.y + self.height;
        let min_z = self.z;
        let max_z = self.z + self.depth;

        let other_min_x = other.x;
        let other_max_x = other.x + other.width;
        let other_min_y = other.y;
        let other_max_y = other.y + other.height;
        let other_min_z = other.z;
        let other_max_z = other.z + other.depth;

        if min_x <= other_max_x
            && max_x >= other_min_x
            && min_y <= other_max_y
            && max_y >= other_min_y
            && min_z <= other_max_z
            && max_z >= other_min_z {

            // Check if corners
            let is_on_edge_x = min_x == other_max_x || max_x == other_min_x;
            let is_on_edge_y = min_y == other_max_y || max_y == other_min_y;
            let is_on_edge_z = min_z == other_max_z || max_z == other_min_z;

            // Check if more than one edge is overlapping
            if (is_on_edge_x as i64 + is_on_edge_y as i64 + is_on_edge_z as i64) > 1 {
                return false;
            }

            return true;
        }

        false
    }
}

#[derive(Serialize, Deserialize)]
pub struct StitchGraph3D {
    pub shift_x: Vec<f32>,
    pub shift_y: Vec<f32>,
    pub shift_z: Vec<f32>,
    pub adjacency_matrix: Vec<f32>,
    pub num_nodes: usize,
}

#[derive(Serialize, Deserialize)]
pub struct Pair3D {
    pub i: usize,
    pub j: usize,
    pub peaks: Vec<(i64, i64, i64, f32)>,
}

#[derive(Serialize, Deserialize)]
pub struct Stitch3DResult {
    pub pairs: Vec<Pair3D>,
    pub subgraphs: Vec<Vec<usize>>,
    pub offsets: Vec<Vec<(f32, f32, f32)>>,
}

pub fn stitch(
    images: &[Image3DFile],
    layout: &[IBox3D],
    overlap_ratio: f32,
    check_peaks: usize,
    correlation_threshold: f32,
    dimension_mask: (bool, bool, bool),
) -> Stitch3DResult {
    let mut overlap_map = create_overlap_map(images, layout);
    println!("Overlap map: {:?}", overlap_map);
    overlap_map
        .iter_mut()
        .enumerate()
        .for_each(|(i, overlap_list)| {
            overlap_list.retain(|&j| i < j);
        });

    println!("Computing shifts");

    let todo: usize = overlap_map.iter().map(|x| x.len()).sum();
    let done = Mutex::new(0);
    let pairs: Vec<Pair3D> = overlap_map
        .par_iter()
        .enumerate()
        .flat_map(|(i, overlap_list)| {

            let image_ref_file = &images[i];
            let image_ref = image_ref_file.get_image();
            
            overlap_list
                .iter()
                .map(|&j| {
                    let layout_ref = &layout[i];
                    let layout_move = &layout[j];
                    let image_move = images[j].get_image();

                    let (ref_img, ref_roi, mov_img, mov_roi) = get_intersection(
                        &image_ref,
                        layout_ref,
                        &image_move,
                        layout_move,
                        overlap_ratio,
                    );

                    drop(image_move);

                    let max_size = (
                        ref_roi.width.max(mov_roi.width) as usize,
                        ref_roi.height.max(mov_roi.height) as usize,
                        ref_roi.depth.max(mov_roi.depth) as usize,
                    );

                    let mut ref_fft = to_complex_with_padding(&ref_img, max_size.0, max_size.1, max_size.2);
                    let mut mov_fft = to_complex_with_padding(&mov_img, max_size.0, max_size.1, max_size.2);

                    fft_3d(
                        max_size.0,
                        max_size.1,
                        max_size.2,
                        &mut ref_fft,
                        rustfft::FftDirection::Forward,
                    );

                    fft_3d(
                        max_size.0,
                        max_size.1,
                        max_size.2,
                        &mut mov_fft,
                        rustfft::FftDirection::Forward,
                    );

                    let mut phase_corr = ref_fft
                        .iter()
                        .zip(mov_fft.iter())
                        .map(|(a, b)| {
                            let res = a * b.conj();
                            let norm = res.norm();
                            if norm > f32::EPSILON {
                                res / norm
                            } else {
                                Complex::zero()
                            }
                        })
                        .collect::<Vec<_>>();

                    fft_3d(
                        max_size.2,
                        max_size.1,
                        max_size.0,
                        &mut phase_corr,
                        rustfft::FftDirection::Inverse,
                    );

                    drop(ref_fft);
                    drop(mov_fft);

                    let image = Image3D {
                        width: max_size.0,
                        height: max_size.1,
                        depth: max_size.2,
                        data: phase_corr
                            .iter()
                            .map(|x| x.norm())
                            .collect::<Vec<_>>(),
                    };

                    drop(phase_corr);

                    let mut peaks = find_peaks_3d(&image, check_peaks)
                        .iter()
                        .flat_map(|peak| disambiguate_3d(max_size.0, max_size.1, max_size.2, *peak))
                        .collect::<Vec<_>>();

                    // Mask peaks
                    peaks.iter_mut().for_each(|peak| {
                        if !dimension_mask.0 {
                            peak.0 = 0;
                        }

                        if !dimension_mask.1 {
                            peak.1 = 0;
                        }

                        if !dimension_mask.2 {
                            peak.2 = 0;
                        }
                    });

                    // Test peaks
                    peaks.iter_mut().for_each(|peak| {
                        let res = test_cross_3d(&ref_img, &mov_img, (peak.0, peak.1, peak.2), 0.01);
                        peak.3 = res.0;
                    });

                    drop(ref_img);
                    drop(mov_img);

                    // Filter peaks
                    peaks.retain(|peak| peak.3 > correlation_threshold);

                    // Sort by highest R
                    peaks.sort_by(|a, b| b.3.partial_cmp(&a.3).unwrap());

                    // Adjust peaks by roi
                    peaks.iter_mut().for_each(|peak| {
                        peak.0 += ref_roi.x - mov_roi.x;
                        peak.1 += ref_roi.y - mov_roi.y;
                        peak.2 += ref_roi.z - mov_roi.z;
                    });

                    let mut done2 = done.lock().unwrap();
                    *done2 += 1;
                    println!("Progress: {}/{}", *done2, todo);

                    Pair3D {
                        i,
                        j,
                        peaks,
                    }
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();

    println!("Global optimization");
    let graph = pairs_to_graph(&pairs, images.len());
    let subgraphs = find_subgraphs(&graph);
    let offsets = subgraphs
        .iter()
        .map(|subgraph_indexes| {
            let subgraph = extract_subgraph(&graph, subgraph_indexes);
            calculate_offsets_from_graph(&subgraph)
        })
        .collect::<Vec<_>>();
 
    Stitch3DResult {
        pairs,
        subgraphs,
        offsets,
    }
}

fn to_complex_with_padding(
    image: &Image3D,
    width: usize,
    height: usize,
    depth: usize,
) -> Vec<Complex<f32>> {
    let mut data = vec![Complex::zero(); width * height * depth];
    let old_width = image.width;
    let old_height = image.height;
    let old_depth = image.depth;

    let start_x = (width - old_width) / 2;
    let start_y = (height - old_height) / 2;
    let start_z = (depth - old_depth) / 2;
    let end_x = start_x + old_width;
    let end_y = start_y + old_height;
    let end_z = start_z + old_depth;

    for z in start_z..end_z {
        for y in start_y..end_y {
            for x in start_x..end_x {
                let src_x = x - start_x;
                let src_y = y - start_y;
                let src_z = z - start_z;
                let val = image.get(src_x, src_y, src_z);
                data[x + y * width + z * width * height] = Complex::new(val, 0.0);
            }
        }
    }

    data
}

fn get_intersection(
    image_ref: &Image3D,
    layout_ref: &IBox3D,
    image_move: &Image3D,
    layout_move: &IBox3D,
    overlap_ratio: f32,
) -> (Image3D, IBox3D, Image3D, IBox3D)
{
    let ref_center = (
        layout_ref.x as f32 + layout_ref.width as f32 / 2.0,
        layout_ref.y as f32 + layout_ref.height as f32 / 2.0,
        layout_ref.z as f32 + layout_ref.depth as f32 / 2.0,
    );

    let move_center = (
        layout_move.x as f32 + layout_move.width as f32 / 2.0,
        layout_move.y as f32 + layout_move.height as f32 / 2.0,
        layout_move.z as f32 + layout_move.depth as f32 / 2.0,
    );

    let diff = (
        move_center.0 - ref_center.0,
        move_center.1 - ref_center.1,
        move_center.2 - ref_center.2,
    );

    let norm = (diff.0.powi(2) + diff.1.powi(2) + diff.2.powi(2)).sqrt();
    let ratios = (
        diff.0 / norm,
        diff.1 / norm,
        diff.2 / norm
    );

    let new_norm = norm * (1.0 - overlap_ratio);
    let new_diff = (
        ratios.0 * new_norm,
        ratios.1 * new_norm,
        ratios.2 * new_norm,
    );

    let new_center = (
        ref_center.0 + new_diff.0,
        ref_center.1 + new_diff.1,
        ref_center.2 + new_diff.2,
    );

    let new_move_pos = (
        new_center.0 - layout_move.width as f32 / 2.0,
        new_center.1 - layout_move.height as f32 / 2.0,
        new_center.2 - layout_move.depth as f32 / 2.0,
    );

    let new_move_max = (
        new_move_pos.0 + layout_move.width as f32,
        new_move_pos.1 + layout_move.height as f32,
        new_move_pos.2 + layout_move.depth as f32,
    );

    let ref_pos_max = (
        layout_ref.x as f32 + layout_ref.width as f32,
        layout_ref.y as f32 + layout_ref.height as f32,
        layout_ref.z as f32 + layout_ref.depth as f32,
    );

    let start = (
        new_move_pos.0.max(layout_ref.x as f32),
        new_move_pos.1.max(layout_ref.y as f32),
        new_move_pos.2.max(layout_ref.z as f32),
    );

    let end = (
        new_move_max.0.min(ref_pos_max.0),
        new_move_max.1.min(ref_pos_max.1),
        new_move_max.2.min(ref_pos_max.2),
    );

   //println!("Start: {:?}", start);
    //println!("End: {:?}", end);

    let ref_start = (
        start.0 - layout_ref.x as f32,
        start.1 - layout_ref.y as f32,
        start.2 - layout_ref.z as f32,
    );

    let move_start = (
        start.0 - new_move_pos.0,
        start.1 - new_move_pos.1,
        start.2 - new_move_pos.2,
    );
    
    let ref_end = (
        end.0 - layout_ref.x as f32,
        end.1 - layout_ref.y as f32,
        end.2 - layout_ref.z as f32,
    );

    let move_end = (
        end.0 - new_move_pos.0,
        end.1 - new_move_pos.1,
        end.2 - new_move_pos.2,
    );

    //println!("Ref offset: {:?}", ref_start);
   // println!("Move offset: {:?}", move_start);

    let ref_roi = (
        ref_start.0 / layout_ref.width as f32 * image_ref.width as f32,
        ref_start.1 / layout_ref.height as f32 * image_ref.height as f32,
        ref_start.2 / layout_ref.depth as f32 * image_ref.depth as f32,
        ref_end.0 / layout_ref.width as f32 * image_ref.width as f32,
        ref_end.1 / layout_ref.height as f32 * image_ref.height as f32,
        ref_end.2 / layout_ref.depth as f32 * image_ref.depth as f32,
    );

    //println!("Ref roi: {:?}", ref_roi);

    let move_roi = (
        move_start.0 / layout_move.width as f32 * image_move.width as f32,
        move_start.1 / layout_move.height as f32 * image_move.height as f32,
        move_start.2 / layout_move.depth as f32 * image_move.depth as f32,
        move_end.0 / layout_move.width as f32 * image_move.width as f32,
        move_end.1 / layout_move.height as f32 * image_move.height as f32,
        move_end.2 / layout_move.depth as f32 * image_move.depth as f32,
    );

    let ref_roi = (
        ref_roi.0.clamp(0.0, image_ref.width as f32).round() as i64,
        ref_roi.1.clamp(0.0, image_ref.height as f32).round() as i64,
        ref_roi.2.clamp(0.0, image_ref.depth as f32).round() as i64,
        ref_roi.3.clamp(0.0, image_ref.width as f32).round() as i64,
        ref_roi.4.clamp(0.0, image_ref.height as f32).round() as i64,
        ref_roi.5.clamp(0.0, image_ref.depth as f32).round() as i64,
    );

    let move_roi = (
        move_roi.0.clamp(0.0, image_move.width as f32).round() as i64,
        move_roi.1.clamp(0.0, image_move.height as f32).round() as i64,
        move_roi.2.clamp(0.0, image_move.depth as f32).round() as i64,
        move_roi.3.clamp(0.0, image_move.width as f32).round() as i64,
        move_roi.4.clamp(0.0, image_move.height as f32).round() as i64,
        move_roi.5.clamp(0.0, image_move.depth as f32).round() as i64,
    );

    let ref_roi = IBox3D::new(ref_roi.0, ref_roi.1, ref_roi.2, ref_roi.3 - ref_roi.0, ref_roi.4 - ref_roi.1, ref_roi.5 - ref_roi.2);
    let move_roi = IBox3D::new(move_roi.0, move_roi.1, move_roi.2, move_roi.3 - move_roi.0, move_roi.4 - move_roi.1, move_roi.5 - move_roi.2);

    (extract_image_with_roi(image_ref, &ref_roi), ref_roi, extract_image_with_roi(image_move, &move_roi), move_roi)
}

fn extract_image_with_roi(
    image: &Image3D,
    roi: &IBox3D,
) -> Image3D {
    let width = roi.width as usize;
    let height = roi.height as usize;
    let depth = roi.depth as usize;

    let mut new_image = Image3D {
        width,
        height,
        depth,
        data: vec![0.0; (width * height * depth) as usize],
    };

    for z in 0..depth {
        for y in 0..height {
            for x in 0..width {
                let src_x = x + roi.x as usize;
                let src_y = y + roi.y as usize;
                let src_z = z + roi.z as usize;
                let val = image.get(src_x, src_y, src_z);
                new_image.set(x, y, z, val);
            }
        }
    }

    new_image
}

fn calculate_offsets_from_graph(graph: &StitchGraph3D) -> Vec<(f32, f32, f32)> {
    let num_nodes = graph.num_nodes;
    if num_nodes == 0 {
        panic!("Empty graph");
    }

    if num_nodes == 1 {
        return vec![(0.0, 0.0, 0.0)];
    }

    let n = num_nodes - 1;
    let mut laplacian = vec![0.0; n * n];
    for i in 0..n {
        for j in 0..n {
            if i == j {
                let mut sum = 0.0;
                for k in 0..num_nodes {
                    sum += graph.adjacency_matrix[i * num_nodes + k];
                }
                laplacian[i * n + j] = sum;
            } else {
                laplacian[i * n + j] = -graph.adjacency_matrix[i * num_nodes + j];
            }
        }
    }

    let mut y_vec_x = vec![0.0; n];
    let mut y_vec_y = vec![0.0; n];
    let mut y_vec_z = vec![0.0; n];

    for i in 0..n {
        let mut sum_x = 0.0;
        let mut sum_y = 0.0;
        let mut sum_z = 0.0;
        for j in 0..num_nodes {
            sum_x += graph.shift_x[i * num_nodes + j];
            sum_y += graph.shift_y[i * num_nodes + j];
            sum_z += graph.shift_z[i * num_nodes + j];
        }
        y_vec_x[i] = -sum_x;
        y_vec_y[i] = -sum_y;
        y_vec_z[i] = -sum_z;
    }

    let mut x_vec_x = solve_linear_system(&laplacian, &y_vec_x, n);
    x_vec_x.push(0.0);

    let mut x_vec_y = solve_linear_system(&laplacian, &y_vec_y, n);
    x_vec_y.push(0.0);

    let mut x_vec_z = solve_linear_system(&laplacian, &y_vec_z, n);
    x_vec_z.push(0.0);

    // Find minimum
    let mut min_x = f32::INFINITY;
    let mut min_y = f32::INFINITY;
    let mut min_z = f32::INFINITY;

    for i in 0..num_nodes {
        if x_vec_x[i] < min_x {
            min_x = x_vec_x[i];
        }
        if x_vec_y[i] < min_y {
            min_y = x_vec_y[i];
        }
        if x_vec_z[i] < min_z {
            min_z = x_vec_z[i];
        }
    }

    // Normalize
    for i in 0..num_nodes {
        x_vec_x[i] -= min_x;
        x_vec_y[i] -= min_y;
        x_vec_z[i] -= min_z;
    }

    let zipped = x_vec_x
        .iter()
        .zip(x_vec_y.iter())
        .zip(x_vec_z.iter())
        .map(|((x, y), z)| (*x, *y, *z))
        .collect::<Vec<_>>();

    return zipped;
}

fn extract_subgraph(graph: &StitchGraph3D, subgraph_indexes: &[usize]) -> StitchGraph3D {
    let subgraph_len = subgraph_indexes.len();
    let mut shift_x = vec![0.0; subgraph_len * subgraph_len];
    let mut shift_y = vec![0.0; subgraph_len * subgraph_len];
    let mut shift_z = vec![0.0; subgraph_len * subgraph_len];
    let mut adjacency_matrix = vec![0.0; subgraph_len * subgraph_len];

    for i in 0..subgraph_len {
        for j in 0..subgraph_len {
            let i_idx = subgraph_indexes[i];
            let j_idx = subgraph_indexes[j];
            shift_x[i * subgraph_len + j] = graph.shift_x[i_idx * graph.num_nodes + j_idx];
            shift_y[i * subgraph_len + j] = graph.shift_y[i_idx * graph.num_nodes + j_idx];
            shift_z[i * subgraph_len + j] = graph.shift_z[i_idx * graph.num_nodes + j_idx];
            adjacency_matrix[i * subgraph_len + j] =
                graph.adjacency_matrix[i_idx * graph.num_nodes + j_idx];
        }
    }

    StitchGraph3D {
        shift_x,
        shift_y,
        shift_z,
        adjacency_matrix,
        num_nodes: subgraph_len,
    }
}

fn pairs_to_graph(
    pairs: &[Pair3D],
    num_images: usize,
) -> StitchGraph3D {
    let mut shift_x = vec![0.0; num_images * num_images];
    let mut shift_y = vec![0.0; num_images * num_images];
    let mut shift_z = vec![0.0; num_images * num_images];
    let mut adjacency_matrix = vec![0.0; num_images * num_images];

    pairs
        .iter()
        .for_each(|pair| {
                if pair.peaks.len() > 0 {
                    let i = pair.i;
                    let j = pair.j;
                    let ij_index = i * num_images + j;
                    let ji_index = j * num_images + i;

                    let peak = &pair.peaks[0];
                    shift_x[ij_index] = peak.0 as f32;
                    shift_y[ij_index] = peak.1 as f32;
                    shift_z[ij_index] = peak.2 as f32;

                    shift_x[ji_index] = -peak.0 as f32;
                    shift_y[ji_index] = -peak.1 as f32;
                    shift_z[ji_index] = -peak.2 as f32;

                    adjacency_matrix[ij_index] = 1.0;
                    adjacency_matrix[ji_index] = 1.0;
                }
        });

    StitchGraph3D {
        shift_x,
        shift_y,
        shift_z,
        adjacency_matrix,
        num_nodes: num_images,
    }
}

fn find_subgraphs(graph: &StitchGraph3D) -> Vec<Vec<usize>> {
    let mut visited = vec![false; graph.num_nodes];
    let mut subgraphs = vec![];

    for i in 0..graph.num_nodes {
        if visited[i] {
            continue;
        }

        let mut subgraph = vec![];
        let mut stack = vec![i];

        while let Some(node) = stack.pop() {
            if visited[node] {
                continue;
            }

            visited[node] = true;
            subgraph.push(node);

            for j in 0..graph.num_nodes {
                if graph.adjacency_matrix[node * graph.num_nodes + j] == 1.0 {
                    stack.push(j);
                }
            }
        }

        // Sort by node index
        subgraph.sort();

        subgraphs.push(subgraph);
    }

    // Sort subgraphs by size
    subgraphs.sort_by(|a, b| b.len().cmp(&a.len()));

    subgraphs
}

fn solve_linear_system(a: &[f32], b: &[f32], size: usize) -> Vec<f32> {
    // Solves Ax = B using Guassian elimination
    let mut augmented_matrix = vec![0.0; size * (size + 1)];
    for i in 0..size {
        for j in 0..size {
            augmented_matrix[i * (size + 1) + j] = a[i * size + j];
        }
        augmented_matrix[i * (size + 1) + size] = b[i];
    }

    for i in 0..size {
        // Find pivot
        let mut max_row = i;
        for j in i + 1..size {
            if augmented_matrix[j * (size + 1) + i].abs()
                > augmented_matrix[max_row * (size + 1) + i].abs()
            {
                max_row = j;
            }
        }

        // Swap rows
        augmented_matrix.swap(i * (size + 1), max_row * (size + 1));

        // Eliminate
        for j in i + 1..size {
            let factor =
                augmented_matrix[j * (size + 1) + i] / augmented_matrix[i * (size + 1) + i];
            for k in i..size + 1 {
                augmented_matrix[j * (size + 1) + k] -=
                    factor * augmented_matrix[i * (size + 1) + k];
            }
        }
    }

    // Back substitution
    let mut x = vec![0.0; size];
    for i in (0..size).rev() {
        x[i] = augmented_matrix[i * (size + 1) + size];
        for j in i + 1..size {
            x[i] -= augmented_matrix[i * (size + 1) + j] * x[j];
        }
        x[i] /= augmented_matrix[i * (size + 1) + i];
    }

    x
}

fn create_overlap_map(
    images: &[Image3DFile],
    layout: &[IBox3D],
) -> Vec<Vec<usize>> {
    (0..images.len())
        .map(|i| {
            let mut overlapping = vec![];
            let current = &layout[i];

            for j in 0..images.len() {
                if i == j {
                    continue;
                }
                let other = &layout[j];

                if current.is_overlapping(other) {
                    overlapping.push(j);
                }
            }
            overlapping
        })
        .collect()
}

fn fft_3d<T: FftNum>(
    width: usize,
    height: usize,
    num_frames: usize,
    img_buffer: &mut [Complex<T>],
    direction: rustfft::FftDirection,
) {
    // Compute the FFT of each row of the image.
    let mut planner = FftPlanner::new();
    let fft_width = planner.plan_fft(width, direction);
    let mut scratch = vec![Complex::zero(); fft_width.get_outofplace_scratch_len()];
    let mut other = vec![Complex::zero(); img_buffer.len()];

    img_buffer
        .chunks_exact_mut(width)
        .zip(other.chunks_exact_mut(width))
        .for_each(|(input, output)| {
            fft_width.process_outofplace_with_scratch(input, output, &mut scratch);
        });

    // Transpose the image to be able to compute the FFT on the other dimension.
    let frame_size = width * height;
    img_buffer
        .chunks_exact_mut(frame_size)
        .zip(other.chunks_exact(frame_size))
        .for_each(|(output, input)| {
            transpose(input, output, width, height);
        });

    // Compute the FFT of each column of the image.
    let fft_height = planner.plan_fft(height, direction);
    scratch.resize(fft_height.get_outofplace_scratch_len(), Complex::zero());

    img_buffer
        .chunks_exact_mut(height)
        .zip(other.chunks_exact_mut(height))
        .for_each(|(input, output)| {
            fft_height.process_outofplace_with_scratch(input, output, &mut scratch);
        });

    // Transpose the image to be able to compute the FFT on the num_frames dimension.
    for i in 0..num_frames {
        for x in 0..width {
            for y in 0..height {
                img_buffer[x * num_frames * height + y * num_frames + i] =
                    other[i * width * height + x * height + y];
            }
        }
    }

    // Compute the FFT of each frame of the image.
    let fft_frames = planner.plan_fft(num_frames, direction);
    scratch.resize(fft_frames.get_inplace_scratch_len(), Complex::zero());

    img_buffer
        .chunks_exact_mut(num_frames)
        .for_each(|frame| fft_frames.process_with_scratch(frame, &mut scratch));
}

fn find_peaks_3d(image: &Image3D, check_peaks: usize) -> Vec<(i64, i64, i64, f32)> {
    let w = image.width;
    let h = image.height;
    let d = image.depth;

    let mut peaks = vec![(0, 0, 0, f32::NEG_INFINITY); check_peaks];

    for z in 0..d {
        for y in 0..h {
            for x in 0..w {
                if is_local_maxima_3d(image, (x, y, z)) {
                    let val = image.data[z * h * w + y * w + x];

                    // Insert into peaks
                    for i in 0..check_peaks {
                        if val > peaks[i].3 {
                            peaks.insert(i, (x as i64, y as i64, z as i64, val));
                            // Remove lowest peak
                            peaks.pop();
                            break;
                        }
                    }
                }
            }
        }
    }

    // Cleanup peaks
    let half_w = w as i64 / 2;
    let half_h = h as i64 / 2;
    let half_d = d as i64 / 2;
    peaks.iter_mut().for_each(|peak| {
        if peak.0 >= half_w {
            peak.0 = peak.0 - w as i64;
        }

        if peak.1 >= half_h {
            peak.1 = peak.1 - h as i64;
        }

        if peak.2 >= half_d {
            peak.2 = peak.2 - d as i64;
        }
    });

    peaks
}

fn is_local_maxima_3d(image: &Image3D, pos: (usize, usize, usize)) -> bool {
    let width = image.width;
    let height = image.height;
    let depth = image.depth;
    let frame_size = width * height;
    let x = pos.0;
    let y = pos.1;
    let z = pos.2;

    let value = image.data[pos.2 * frame_size + pos.1 * width + pos.0];

    for zs in -1..=1 {
        for ys in -1..=1 {
            for xs in -1..=1 {
                if xs == 0 && ys == 0 && zs == 0 {
                    continue;
                }

                let xn = ((x as i64 + xs + width as i64) % width as i64) as usize;
                let yn = ((y as i64 + ys + height as i64) % height as i64) as usize;
                let zn = ((z as i64 + zs + depth as i64) % depth as i64) as usize;

                let val = image.data[zn * frame_size + yn * width + xn];
                if val > value {
                    return false;
                }
            }
        }
    }

    return true;
}

fn disambiguate_3d(
    width: usize,
    height: usize,
    num_frames: usize,
    shift: (i64, i64, i64, f32),
) -> Vec<(i64, i64, i64, f32)> {
    // Disambiguate the shift
    let mut points = vec![(shift.0, shift.1, shift.2, shift.3); 8];

    points[1].0 = if points[0].0 < 0 {
        points[0].0 + width as i64
    } else {
        points[0].0 - width as i64
    };

    points[2].1 = if points[0].1 < 0 {
        points[0].1 + height as i64
    } else {
        points[0].1 - height as i64
    };

    points[3].2 = if points[0].2 < 0 {
        points[0].2 + num_frames as i64
    } else {
        points[0].2 - num_frames as i64
    };

    points[4] = (points[1].0, points[2].1, points[0].2, points[0].3);
    points[5] = (points[0].0, points[2].1, points[3].2, points[0].3);
    points[6] = (points[1].0, points[0].1, points[3].2, points[0].3);
    points[7] = (points[1].0, points[2].1, points[3].2, points[0].3);

    points
}

fn test_cross_3d(
    img1: &Image3D,
    img2: &Image3D,
    shift: (i64, i64, i64),
    min_overlap: f64,
) -> (f32, f32, i64) {
    let w1 = img1.width;
    let h1 = img1.height;
    let d1 = img1.depth;

    let w2 = img2.width;
    let h2 = img2.height;
    let d2 = img2.depth;

    let sx = shift.0;
    let sy = shift.1;
    let sz = shift.2;

    let offset_img1_x = 0.max(-sx) as usize;
    let offset_img1_y = 0.max(-sy) as usize;
    let offset_img1_z = 0.max(-sz) as usize;

    let offset_img2_x = 0.max(sx) as usize;
    let offset_img2_y = 0.max(sy) as usize;
    let offset_img2_z = 0.max(sz) as usize;

    let start_x = offset_img1_x.max(offset_img2_x);
    let start_y = offset_img1_y.max(offset_img2_y);
    let start_z = offset_img1_z.max(offset_img2_z);

    let end_x = (offset_img1_x + w1).min(offset_img2_x + w2);
    let end_y = (offset_img1_y + h1).min(offset_img2_y + h2);
    let end_z = (offset_img1_z + d1).min(offset_img2_z + d2);

    let mut avg1 = 0.0;
    let mut avg2 = 0.0;
    let mut count = 0;

    for z in start_z..end_z {
        for y in start_y..end_y {
            for x in start_x..end_x {
                let val1 = img1.data
                    [(z - offset_img1_z) * w1 * h1 + (y - offset_img1_y) * w1 + (x - offset_img1_x)]
                    as f64;
                let val2 = img2.data
                    [(z - offset_img2_z) * w2 * h2 + (y - offset_img2_y) * w2 + (x - offset_img2_x)]
                    as f64;
                avg1 += val1;
                avg2 += val2;
                count += 1;
            }
        }
    }

    if count as f64 <= (w1 * h1 * d1).min(w2 * h2 * d2) as f64 * min_overlap {
        return (0.0, f32::INFINITY, count);
    }

    avg1 /= count as f64;
    avg2 /= count as f64;

    let mut var1 = 0.0;
    let mut var2 = 0.0;
    let mut ssq = 0.0;
    let mut covar = 0.0;

    for z in start_z..end_z {
        for y in start_y..end_y {
            for x in start_x..end_x {
                let val1 = img1.data
                    [(z - offset_img1_z) * w1 * h1 + (y - offset_img1_y) * w1 + (x - offset_img1_x)]
                    as f64;
                let val2 = img2.data
                    [(z - offset_img2_z) * w2 * h2 + (y - offset_img2_y) * w2 + (x - offset_img2_x)]
                    as f64;

                let pixel_ssq = (val1 - val2).powi(2);
                ssq += pixel_ssq;

                let dist1 = val1 - avg1;
                let dist2 = val2 - avg2;

                covar += dist1 * dist2;
                var1 += dist1.powi(2);
                var2 += dist2.powi(2);
            }
        }
    }

    ssq /= count as f64;
    covar /= count as f64;
    var1 /= count as f64;
    var2 /= count as f64;

    let std1 = var1.sqrt();
    let std2 = var2.sqrt();

    if std1 == 0.0 || std2 == 0.0 {
        return (0.0, f32::INFINITY, count);
    }

    let r = covar / (std1 * std2);

    return (r as f32, ssq as f32, count);
}
