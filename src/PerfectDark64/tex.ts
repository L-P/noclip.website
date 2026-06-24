import ArrayBufferSlice from "../ArrayBufferSlice";
import type { Inflater }  from "./rom";
import { assert, hexzero0x, hexzero } from "../util";
import { parseTLUT, ImageFormat, ImageSize, TextFilt, TexCM, getSizBitsPerPixel, decodeTex_RGBA16, decodeTex_RGBA32, decodeTex_CI4, decodeTex_CI8, decodeTex_IA4, decodeTex_IA8, decodeTex_IA16, decodeTex_I4, decodeTex_I8, TextureLUT, getTLUTSize } from "../Common/N64/Image.js";

export interface InflatedTexture {
    format: ImageFormat;
    palette: number[]; // May be empty depending on format.
    width: number;
    height: number;
}

export enum Format {
    RGBA32     = 0x00, // 32-bit RGBA (8/8/8/8)
    RGBA16     = 0x01, // 16-bit RGBA (5/5/5/1)
    RGB24      = 0x02, // 24-bit RGB (8/8/8)
    RGB15      = 0x03, // 15-bit RGB (5/5/5)
    IA16       = 0x04, // 16-bit grayscale+alpha
    IA8        = 0x05, // 8-bit grayscale+alpha (4/4)
    IA4        = 0x06, // 4-bit grayscale+alpha (3/1)
    I8         = 0x07, // 8-bit grayscale
    I4         = 0x08, // 4-bit grayscale
    RGBA16_CI8 = 0x09, // 16-bit 5551 paletted colour with 8-bit palette indexes
    RGBA16_CI4 = 0x0a, // 16-bit 5551 paletted colour with 4-bit palette indexes
    IA16_CI8   = 0x0b, // 16-bit 88 paletted greyscale+alpha with 8-bit palette indexes
    IA16_CI4   = 0x0c, // 16-bit 88 paletted greyscale+alpha with 4-bit palette indexes
}

// Returns the size of each _stored_ pixel in bits. ie. on paletted images it
// returns the size of the index.
export function formatBPP(format: Format): number {
    switch (format) {
        case Format.RGBA32:
            return 32;
        case Format.RGB24:
            return 24;
        case Format.RGBA16:
            return 16;
        case Format.IA16:
            return 16;
        case Format.RGBA16_CI8:
            return 8;
        case Format.RGBA16_CI4:
            return 4;
        case Format.IA16_CI8:
            return 8;
        case Format.IA16_CI4:
            return 4;
        case Format.IA8:
        case Format.I8:
            return 8;
        case Format.IA4:
        case Format.I4:
            return 4;
        default:
            throw new Error("unknown texture format " + hexzero0x(format));
    }
}

function toGBIFormat(format: Format): ImageFormat {
    const mapping: ImageFormat[] = [
        ImageFormat.G_IM_FMT_RGBA,
        ImageFormat.G_IM_FMT_RGBA,
        ImageFormat.G_IM_FMT_RGBA,
        ImageFormat.G_IM_FMT_RGBA,
        ImageFormat.G_IM_FMT_IA,
        ImageFormat.G_IM_FMT_IA,
        ImageFormat.G_IM_FMT_IA,
        ImageFormat.G_IM_FMT_I,
        ImageFormat.G_IM_FMT_I,
        ImageFormat.G_IM_FMT_CI,
        ImageFormat.G_IM_FMT_CI,
        ImageFormat.G_IM_FMT_CI,
        ImageFormat.G_IM_FMT_CI,
    ];

    return mapping[format];
}

export interface TextureListEntry {
    soundSurfaceType: number; // 4  bits
    surfaceType:      number; // 4  bits
    dataOffset:       number; // 24 bits

    // The rest is unused / padding.
}
export const textureListEntryStructSize = 8;

export interface TextureConfig {
    ptr: number; // uint32

    // All uint8
    width:  number;
    height: number;
    level:  number;
    format: number;
    depth:  number;
    s:      number;
    t:      number;
    unk0b:  number;
}
export const textureConfigStructSize = 12;
export function textureConfigFromView(view: DataView, offset: number): TextureConfig {
    return {
        ptr: view.getUint32(offset),
        width:  view.getUint8(offset + 4),
        height: view.getUint8(offset + 5),
        level:  view.getUint8(offset + 6),
        format: view.getUint8(offset + 7),
        depth:  view.getUint8(offset + 8),
        s:      view.getUint8(offset + 9),
        t:      view.getUint8(offset + 10),
        unk0b:  view.getUint8(offset + 11),
    };
}

// Returns raw data, writes format and dimensions to {@param texture}.
export function inflateTexture(
    texture: InflatedTexture,
    data: ArrayBufferSlice,
    decompress: Inflater,
): ArrayBufferSlice {
    if (data.byteLength <= 0) {
        return data;
    }

    const view = data.createDataView();
    const header = view.getUint8(0);
    const isZlib = !!((header & 0x40) >> 6);
    const hasLod = !!((header & 0x80) >> 7);
    const numLods = (header & 0x3f);

    if (!isZlib) {
        // TODO
        return data.subarray(0, 0);
    }

    return inflateZlibTexture(texture, data, hasLod, numLods, decompress);
}

// FIXME: Ignore LODs for now.
function inflateZlibTexture(
    texture: InflatedTexture,
    data: ArrayBufferSlice,
    hasLod: boolean,
    numLods: number,
    decompress: Inflater,
): ArrayBufferSlice {
    const view = data.createDataView();
    let offset = 1; // Skip header.

    texture.format = view.getUint8(offset++);
    const nColors = view.getUint8(offset++) + 1;

    texture.palette = [];
    for (let i = 0; i < nColors; i++) {
        texture.palette.push(view.getUint16(offset+=2));
    }

    texture.width = view.getUint8(offset++);
    texture.height = view.getUint8(offset++);

    return decompress(data.subarray(offset));
}
