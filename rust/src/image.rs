use core::f32;
use std::{path::{Path, PathBuf}, u16};

use dicom::{core::{DataElement, PrimitiveValue, VR}, dictionary_std::tags, pixeldata::PixelDecoder};
use tiff::decoder::DecodingResult;

/**
 * 3D image data structure
 */
pub struct Image3D {
    pub width: usize,
    pub height: usize,
    pub depth: usize,
    pub data: Vec<f32>,
}


pub struct Image3D16 {
    pub width: usize,
    pub height: usize,
    pub depth: usize,
    pub data: Vec<u16>,
}

pub struct Image3DFile {
    pub width: usize,
    pub height: usize,
    pub depth: usize,
    pub path: PathBuf,
}


#[allow(dead_code)]
impl Image3D {
    /**
     * Create a new blank 3D image
     */
    pub fn new(width: usize, height: usize, depth: usize) -> Image3D {
        Image3D {
            width: width,
            height: height,
            depth: depth,
            data: vec![0.0; width * height * depth],
        }
    }

    /**
     * Get the index of the 1D array from the 3D coordinates
     */
    pub fn get_index(&self, x: usize, y: usize, z: usize) -> usize {
        z * self.width * self.height + y * self.width + x
    }

    /**
     * Get the value at the 3D coordinates
     */
    pub fn get(&self, x: usize, y: usize, z: usize) -> f32 {
        self.data[self.get_index(x, y, z)]
    }

    /**
     * Set the value at the 3D coordinates
     */
    pub fn set(&mut self, x: usize, y: usize, z: usize, value: f32) {
        let index = self.get_index(x, y, z);
        self.data[index] = value;
    }

    /**
     * Get the 2D frame at the z coordinate
     */
    pub fn get_frame(&self, z: usize) -> FrameSlice {
        let start = z * self.width * self.height;
        FrameSlice {
            data: &self.data[start..start + self.width * self.height],
            width: self.width,
            height: self.height,
        }
    }
}


impl Image3DFile {
    pub fn new(width: usize, height: usize, depth: usize, path: PathBuf) -> Image3DFile {
        if !path.exists() {
            panic!("File does not exist");
        }

        Image3DFile {
            width: width,
            height: height,
            depth: depth,
            path: path,
        }
    }
    pub fn get_image(&self) -> Image3D {
        if self.path.extension().unwrap() == "dcm" {
            read_dcm(&self.path)
        } else {
            read_tiff(&self.path)
        }
    }

    pub fn load_dims(&mut self) {
        let image = self.get_image();
        self.width = image.width;
        self.height = image.height;
        self.depth = image.depth;
    }
}

pub struct FrameSlice<'a> {
    pub data: &'a [f32],
    pub width: usize,
    pub height: usize,
}

pub struct Image2D {
    pub width: usize,
    pub height: usize,
    pub data: Vec<f32>,
}

#[allow(dead_code)]
impl Image2D {
    /**
     * Create a new blank 2D image
     */
    pub fn new(width: usize, height: usize) -> Image2D {
        Image2D {
            width: width,
            height: height,
            data: vec![0.0; width * height],
        }
    }

    /**
     * Get the index of the 1D array from the 2D coordinates
     */
    pub fn get_index(&self, x: usize, y: usize) -> usize {
        y * self.width + x
    }

    /**
     * Get the value at the 2D coordinates
     */
    pub fn get(&self, x: usize, y: usize) -> f32 {
        self.data[self.get_index(x, y)]
    }

    /**
     * Set the value at the 2D coordinates
     */
    pub fn set(&mut self, x: usize, y: usize, value: f32) {
        let index = self.get_index(x, y);
        self.data[index] = value;
    }
}

/**
 * Save the image as a DICOM file
 */
#[allow(dead_code)]
pub fn save_as_dcm(
    file_path: &Path,
    image: &Image3D
) {
    let depth = image.depth;
    let width = image.width;
    let height = image.height;

    let pixel_data = image3d_to_u16(image);

    let mut new_obj = dicom::object::InMemDicomObject::new_empty();
    new_obj.put(DataElement::new(
        tags::PHOTOMETRIC_INTERPRETATION,
        VR::CS,
        PrimitiveValue::from("MONOCHROME2"),
    ));

    new_obj.put(DataElement::new(
        tags::SAMPLES_PER_PIXEL,
        VR::US,
        PrimitiveValue::from(1_u16),
    ));

    let label_vector = (0..depth)
        .map(|x| format!("frame_{:03}", x))
        .collect::<Vec<String>>();

    new_obj.put(DataElement::new(
        tags::FRAME_LABEL_VECTOR,
        VR::SH,
        PrimitiveValue::from(label_vector.join("\\")),
    ));

    new_obj.put(DataElement::new(
        tags::FRAME_INCREMENT_POINTER,
        VR::US,
        PrimitiveValue::from(tags::FRAME_LABEL_VECTOR),
    ));
    new_obj.put(DataElement::new(
        tags::NUMBER_OF_FRAMES,
        VR::IS,
        PrimitiveValue::from(depth as u16),
    ));
    new_obj.put(DataElement::new(
        tags::ROWS,
        VR::US,
        PrimitiveValue::from(height as u16),
    ));
    new_obj.put(DataElement::new(
        tags::COLUMNS,
        VR::US,
        PrimitiveValue::from(width as u16),
    ));
    new_obj.put(DataElement::new(
        tags::BITS_ALLOCATED,
        VR::US,
        PrimitiveValue::from(16_u16),
    ));
    new_obj.put(DataElement::new(
        tags::BITS_STORED,
        VR::US,
        PrimitiveValue::from(16_u16),
    ));
    new_obj.put(DataElement::new(
        tags::HIGH_BIT,
        VR::US,
        PrimitiveValue::from(15_u16),
    ));

    new_obj.put(DataElement::new(
        tags::PIXEL_REPRESENTATION,
        VR::US,
        PrimitiveValue::from(0_u16),
    ));

    new_obj.put(DataElement::new(
        tags::SMALLEST_IMAGE_PIXEL_VALUE,
        VR::US,
        PrimitiveValue::from(0_u16),
    ));

    new_obj.put(DataElement::new(
        tags::LARGEST_IMAGE_PIXEL_VALUE,
        VR::US,
        PrimitiveValue::from(65535_u16),
    ));

    new_obj.put(DataElement::new(
        tags::PIXEL_DATA,
        VR::OW,
        PrimitiveValue::from(unsafe { pixel_data.align_to::<u8>().1 }),
    ));

    let class_uid = "1.2.840.10008.5.1.4.1.1.7.3";
    let instance_uid = "1.3.6.1.4.1.9590.100.1.2.272040855713580315506943008480197057345";
    let implementation_class_uid = "1.3.6.1.4.1.9590.100.1.3.100.9.4";
    
    let new_file = new_obj
        .with_meta(
            dicom::object::FileMetaTableBuilder::new()
                // Implicit VR Little Endian
                .transfer_syntax(dicom::dictionary_std::uids::EXPLICIT_VR_LITTLE_ENDIAN)
                .transfer_syntax("1.2.840.10008.1.2")
                .media_storage_sop_class_uid(class_uid)
                .media_storage_sop_instance_uid(instance_uid)
                .implementation_class_uid(implementation_class_uid),
        )
        .unwrap();

    new_file.write_to_file(file_path).unwrap();
}


/**
 * Save the image as a DICOM file
 */
#[allow(dead_code)]
pub fn save_as_dcm_16(
    file_path: &Path,
    image: &Image3D16
) {
    let depth = image.depth;
    let width = image.width;
    let height = image.height;
    let pixel_data = &image.data;

    let mut new_obj = dicom::object::InMemDicomObject::new_empty();
    new_obj.put(DataElement::new(
        tags::PHOTOMETRIC_INTERPRETATION,
        VR::CS,
        PrimitiveValue::from("MONOCHROME2"),
    ));

    new_obj.put(DataElement::new(
        tags::SAMPLES_PER_PIXEL,
        VR::US,
        PrimitiveValue::from(1_u16),
    ));

    let label_vector = (0..depth)
        .map(|x| format!("frame_{:03}", x))
        .collect::<Vec<String>>();

    new_obj.put(DataElement::new(
        tags::FRAME_LABEL_VECTOR,
        VR::SH,
        PrimitiveValue::from(label_vector.join("\\")),
    ));

    new_obj.put(DataElement::new(
        tags::FRAME_INCREMENT_POINTER,
        VR::US,
        PrimitiveValue::from(tags::FRAME_LABEL_VECTOR),
    ));
    new_obj.put(DataElement::new(
        tags::NUMBER_OF_FRAMES,
        VR::IS,
        PrimitiveValue::from(depth as u16),
    ));
    new_obj.put(DataElement::new(
        tags::ROWS,
        VR::US,
        PrimitiveValue::from(height as u16),
    ));
    new_obj.put(DataElement::new(
        tags::COLUMNS,
        VR::US,
        PrimitiveValue::from(width as u16),
    ));
    new_obj.put(DataElement::new(
        tags::BITS_ALLOCATED,
        VR::US,
        PrimitiveValue::from(16_u16),
    ));
    new_obj.put(DataElement::new(
        tags::BITS_STORED,
        VR::US,
        PrimitiveValue::from(16_u16),
    ));
    new_obj.put(DataElement::new(
        tags::HIGH_BIT,
        VR::US,
        PrimitiveValue::from(15_u16),
    ));

    new_obj.put(DataElement::new(
        tags::PIXEL_REPRESENTATION,
        VR::US,
        PrimitiveValue::from(0_u16),
    ));

    new_obj.put(DataElement::new(
        tags::SMALLEST_IMAGE_PIXEL_VALUE,
        VR::US,
        PrimitiveValue::from(0_u16),
    ));

    new_obj.put(DataElement::new(
        tags::LARGEST_IMAGE_PIXEL_VALUE,
        VR::US,
        PrimitiveValue::from(65535_u16),
    ));

    new_obj.put(DataElement::new(
        tags::PIXEL_DATA,
        VR::OW,
        PrimitiveValue::from(unsafe { pixel_data.align_to::<u8>().1 }),
    ));

    let class_uid = "1.2.840.10008.5.1.4.1.1.7.3";
    let instance_uid = "1.3.6.1.4.1.9590.100.1.2.272040855713580315506943008480197057345";
    let implementation_class_uid = "1.3.6.1.4.1.9590.100.1.3.100.9.4";
    
    let new_file = new_obj
        .with_meta(
            dicom::object::FileMetaTableBuilder::new()
                // Implicit VR Little Endian
                .transfer_syntax(dicom::dictionary_std::uids::EXPLICIT_VR_LITTLE_ENDIAN)
                .transfer_syntax("1.2.840.10008.1.2")
                .media_storage_sop_class_uid(class_uid)
                .media_storage_sop_instance_uid(instance_uid)
                .implementation_class_uid(implementation_class_uid),
        )
        .unwrap();

    new_file.write_to_file(file_path).unwrap();
}

/**
 * Save the image as a TIFF file
 */
#[allow(dead_code)]
pub fn save_as_tiff(
    file_path: &Path,
    image: &Image3D
) {
    let width = image.width;
    let height = image.height;
    let depth = image.depth;

    let pixel_data = image3d_to_u16(image);

    let mut tiff = tiff::encoder::TiffEncoder::new(std::fs::File::create(file_path).unwrap()).unwrap();
    for i in 0..depth {
        let frame = &pixel_data[i * width * height..(i + 1) * width * height];
        tiff.write_image::<tiff::encoder::colortype::Gray16>(width as u32, height as u32, &frame).unwrap();
    }
}

/**
 * Convert the image to a vector of u16
 */
pub fn image3d_to_u16(image: &Image3D) -> Vec<u16> {
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    for &x in &image.data {
        if x < min {
            min = x;
        }
        if x > max {
            max = x;
        }
    }
    let range = max - min;

    image.data.iter().map(|x| ((x - min) / range * u16::MAX as f32).round().clamp(0.0, u16::MAX as f32) as u16).collect::<Vec<u16>>()
}

/**
 * Read the image from a dicom file
 */
pub fn read_dcm(file_path: &Path) -> Image3D {
    let dicom_obj = dicom::object::open_file(file_path).unwrap();

    let image = dicom_obj.decode_pixel_data().unwrap();
    let depth = image.number_of_frames() as usize;
    let height = image.rows() as usize;
    let width = image.columns() as usize;
    let vec = image.to_vec().unwrap();

    Image3D {
        depth,
        width,
        height,
        data: vec,
    }
}

/**
 * Read the image from a TIFF file
 */
#[allow(dead_code)]
pub fn read_tiff(file_path: &Path) -> Image3D {
    let mut decoder = tiff::decoder::Decoder::new(std::fs::File::open(file_path).unwrap()).unwrap();
    let mut depth = 0;
    let width = decoder.dimensions().unwrap().0 as usize;
    let height = decoder.dimensions().unwrap().1 as usize;
    let mut vec = Vec::new();
    loop {

        let image: DecodingResult = decoder.read_image().unwrap();

        if let DecodingResult::U8(data) = image {
            vec.extend(data.iter().map(|x| *x as f32));
        } else if let DecodingResult::U16(data) = image {
            vec.extend(data.iter().map(|x| *x as f32));
        } else {
            panic!("Unsupported data type");
        }

        depth += 1;

        if !decoder.more_images() {
            break;
        }

        decoder.next_image().unwrap();
    }

    Image3D {
        depth,
        width,
        height,
        data: vec.iter().map(|x| *x as f32).collect(),
    }
}