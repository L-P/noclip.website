import * as UI from '../ui.js';
import * as Viewer from "../viewer";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, hexzero0x, spliceBisectRight } from "../util";
import {
    parseTLUT, ImageFormat, ImageSize, TextFilt, TexCM, getSizBitsPerPixel,
    decodeTex_RGB24, decodeTex_RGBA16, decodeTex_RGBA32, decodeTex_CI4,
    decodeTex_CI8, decodeTex_IA4, decodeTex_IA8, decodeTex_IA16, decodeTex_I4,
    decodeTex_I8, TextureLUT, getTLUTSize
} from "../Common/N64/Image.js";

import { GfxDevice } from "../gfx/platform/GfxPlatform";

import type { Inflater }  from "./rom";
import BitReader from "./bitreader";

export interface InflatedTexture {
    index: number;
    format: Format;
    imageFormat: ImageFormat;
    imageSize: ImageSize;
    palette: number[]; // May be empty depending on format.
    width: number;
    height: number;

    addr: number; // original in-ROM texture data addr
    offset: number; // offset in the coalesced texture binary we output
    size: number; // raw pixel data length
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
    return [
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
    ][format];
}

function toGBISize(format: Format): ImageSize {
    return [
        ImageSize.G_IM_SIZ_32b,
        ImageSize.G_IM_SIZ_16b,
        ImageSize.G_IM_SIZ_32b,
        ImageSize.G_IM_SIZ_16b,
        ImageSize.G_IM_SIZ_16b,
        ImageSize.G_IM_SIZ_8b,
        ImageSize.G_IM_SIZ_4b,
        ImageSize.G_IM_SIZ_8b,
        ImageSize.G_IM_SIZ_4b,
        ImageSize.G_IM_SIZ_8b,
        ImageSize.G_IM_SIZ_4b,
        ImageSize.G_IM_SIZ_8b,
        ImageSize.G_IM_SIZ_4b,
    ][format];
}

function toGBILUTMode(format: Format): TextureLUT {
    return [
        TextureLUT.G_TT_NONE,
        TextureLUT.G_TT_NONE,
        TextureLUT.G_TT_NONE,
        TextureLUT.G_TT_NONE,
        TextureLUT.G_TT_NONE,
        TextureLUT.G_TT_NONE,
        TextureLUT.G_TT_NONE,
        TextureLUT.G_TT_NONE,
        TextureLUT.G_TT_NONE,
        TextureLUT.G_TT_RGBA16,
        TextureLUT.G_TT_RGBA16,
        TextureLUT.G_TT_IA16,
        TextureLUT.G_TT_IA16,
    ][format];
}

function numChannels(format: Format): number {
    return [
         4, 3, 3, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1
    ][format];
}

enum CompressionMethod {
    UNCOMPRESSED0      = 0,
    UNCOMPRESSED1      = 1,
    HUFFMAN            = 2, // 6
    HUFFMANPERHCHANNEL = 3, // 1
    RLE                = 4, // 156
    LOOKUP             = 5, // 5
    HUFFMANLOOKUP      = 6, // 57
    RLELOOKUP          = 7, // 134
    HUFFMANBLUR        = 8, // 257 textures
    RLEBLUR            = 9,
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

    if (isZlib) {
        return inflateZlibTexture(texture, data, hasLod, numLods, decompress);
    }

    return inflateNonZlibTexture(texture, data);
}

function inflateNonZlibTexture(
    texture: InflatedTexture,
    data: ArrayBufferSlice,
): ArrayBufferSlice {
    const view = data.createDataView();
    let offset = 1; // Skip header.
    const header = view.getUint32(offset);

    texture.format = header  >>> 28;
    texture.width  = (header >>> 20) & 0xFF;
    texture.height = (header >>> 12) & 0xFF;
    texture.palette = [];
    const method: CompressionMethod = (header >> 8) & 0x0F;

   switch (method) {
       case CompressionMethod.RLE:
           return inflateRLETexture(texture, data);
   }

   /* console.warn(
       "unhandled compression method",
       CompressionMethod[method],
       Format[format],
       width,
       height,
   ); // */

   return data.subarray(0, 0); // DEBUG TODO
}

function inflateRLETexture(texture: InflatedTexture, data: ArrayBufferSlice): ArrayBufferSlice {
    const reader = new BitReader(data);
    reader.read(32); // skip both headers

    const btFieldSize = reader.read(3);
    const rlFieldSize = reader.read(3);
    const blockSize = reader.read(4);
    let cost = btFieldSize + rlFieldSize + blockSize + 1;
    let fudge = 0;
    while (cost > 0) {
        cost -= blockSize + 1;
        fudge++;
    }

    let blocksDone = 0;
    const blocksTotal = texture.width * texture.height * numChannels(texture.format);
    const dst = new Uint8Array(blocksTotal);

    if (blockSize > 8) {
        // Technically handled by the game but I found no texture with that
        // block size and it'd be too much of a hassle to handle.
        throw Error("unhandled block size: " + blockSize);
    }

    while (blocksDone < blocksTotal) {
        if (reader.read(1) === 0) {
            dst[blocksDone++] = reader.read(blockSize);
            continue;
        }

        const startBlockIndex = blocksDone - reader.read(btFieldSize) - 1;
        const runNumBlocks = reader.read(rlFieldSize) + fudge;

        if (blockSize <= 8) {
            for (let i = startBlockIndex; i < startBlockIndex + runNumBlocks; i++) {
                dst[blocksDone++] = dst[i];
            }

            dst[blocksDone++] = reader.read(blockSize);
        }
    }

    return ArrayBufferSlice.fromView(dst);
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
    texture.imageFormat = toGBIFormat(texture.format);
    texture.imageSize = toGBISize(texture.format);

    texture.palette = [];
    const nColors = view.getUint8(offset++) + 1;
    for (let i = 0; i < nColors; i++) {
        texture.palette.push(view.getUint16(offset));

        // Do NOT postfix increment the offset in the above call, it somehow
        // manges the last entry of the palette.
        offset += 2;
    }

    texture.width = view.getUint8(offset++);
    texture.height = view.getUint8(offset++);

    return realign(texture, decompress(data.subarray(offset)));
}

// Textures must be aligned to 8 bytes per row but are stored without the padding.
function realign(texture: InflatedTexture, data: ArrayBufferSlice): ArrayBufferSlice {
    const bpp = formatBPP(texture.format);
    const indicePerByte = 8 / bpp;
    const dst = new Uint8Array(Math.ceil(texture.width * texture.height * (bpp / 8)));
    const view = data.createDataView();
    let inOffset = 0;
    let outOffset = 0;
    for (let y = 0; y < texture.height; y++) {
        var written = 0;
        for (let x = 0; x < texture.width; x += indicePerByte) {
            dst[outOffset] = view.getUint8(inOffset);
            outOffset++;
            inOffset++;
        }

        outOffset = (outOffset + 7) & ~7;
    }

    return data;
}

export function decodeTexture(texture: InflatedTexture, view: DataView, lut: Uint8Array): Uint8Array {
    const dst = new Uint8Array(texture.width * texture.height * 4);

    switch (texture.format) {
    case Format.RGBA32:
        decodeTex_RGBA32(dst, view, 0, texture.width, texture.height);
        break;
    case Format.RGBA16:
        decodeTex_RGBA16(dst, view, 0, texture.width, texture.height);
        break;
    case Format.RGBA16_CI8:
        decodeTex_CI8(dst, view, 0, texture.width, texture.height, lut);
        break;
    case Format.RGBA16_CI4:
        decodeTex_CI4(dst, view, 0, texture.width, texture.height, lut);
        break;
    case Format.RGB24:
        decodeTex_RGB24(dst, view, 0, texture.width, texture.height);
        break;
    case Format.I8:
        decodeTex_I8(dst, view, 0, texture.width, texture.height);
        break;
    case Format.I4:
        decodeTex_I4(dst, view, 0, texture.width, texture.height);
        break;
    case Format.IA8:
        decodeTex_IA8(dst, view, 0, texture.width, texture.height);
        break;
    case Format.IA4:
        decodeTex_IA4(dst, view, 0, texture.width, texture.height);
        break;
    default:
        console.warn("unhandled:", Format[texture.format])
        break;
    }

    return dst;
}

export class TextureListHolder implements UI.TextureListHolder {
    private viewerTextures: Viewer.Texture[] = [];
    private numberToIndex: Map<string, number> = new Map();
    private metadata: Map<number, InflatedTexture> = new Map();

    public onnewtextures: (() => void) = (() => {});

    constructor(textures: Viewer.Texture[], meta: InflatedTexture[]) {
        this.addTextures(textures);
        this.addMetadata(meta);

        this.viewerTextures.forEach((texture, i) => {
            this.numberToIndex.set(texture.gfxTexture.ResourceName!, i);
        });
    }

    public addMetadata(meta: InflatedTexture[]): void {
        meta.forEach(v => this.metadata.set(v.index, v));
    }

    public get textureNames(): string[] {
        return this.viewerTextures.map((texture) => texture.gfxTexture.ResourceName!);
    }

    public async getViewerTexture(i: number) {
        return this.viewerTextures[i];
    }

    public getMetadata(i: number): InflatedTexture | undefined {
        return this.metadata.get(i);
    }

    public getByTextureNumber(i: number): Viewer.Texture {
        // FIXME: Use number instead of string.
        const name = hexzero0x(i, 4);
        return this.viewerTextures[this.numberToIndex.get(name)!];
    }

    public addTextures(textures: Viewer.Texture[]): void {
        let changed = false;
        for (let i = 0; i < textures.length; i++) {
            if (this.viewerTextures.find((texture) => textures[i].gfxTexture.ResourceName === texture.gfxTexture.ResourceName) === undefined) {
                spliceBisectRight(
                    this.viewerTextures,
                    textures[i],
                    (a:Viewer.Texture, b:Viewer.Texture) => a.gfxTexture.ResourceName!.localeCompare(b.gfxTexture.ResourceName!),
                );
                changed = true;
            }
        }

        if (changed)
            this.onnewtextures();
    }

    public destroy(device: GfxDevice): void {
        this.viewerTextures.forEach(v => device.destroyTexture(v.gfxTexture));
    }
}
