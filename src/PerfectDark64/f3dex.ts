import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { assert, hexzero0x } from "../util";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";

import { Program } from "./shaders";

export interface Vertex {
    x:      number; // uint16
    y:      number; // uint16
    z:      number; // uint16
    // flags:  number; // uint8 // maybe unused, TODO
    // colour: number; // uint8
    s:      number; // uint16
    t:      number; // uint16
};

export function loadVertexFromView(view: DataView, offset: number): Vertex {
    return {
        x:      view.getInt16(offset),
        y:      view.getInt16(offset + 2),
        z:      view.getInt16(offset + 4),
        // flags:  view.getUint8(offset + 6),
        // colour: view.getUint8(offset + 7),
        s:      view.getInt16(offset + 8),
        t:      view.getInt16(offset + 10),
    };
}

export const vertexStructSize = 12;

export enum Command {
    G_VTX        = 4,   // 0x04
	// Not a real command, used in stored assets and unpacks to multiple commands.
    G_PDTEXASSET = -64, // 0xC0
    G_ENDDL      = -72, // 0xB8
    G_TRI4       = -79,
}

export enum Segment {
    Physical  = 0,
    Title     = 2,
    ModelMTX  = 3,
    ModelVTX  = 4,
    ModelCol1 = 5,
    ModelCol2 = 6,
    BGCol     = 13,
    BGVTX     = 14, // 0x0E
    BGDL      = 15,
}

function bitfield(v: number, pos: number, width: number): number {
	return (v >>> pos) & ((1<<width) - 1);
}

export class GFX {
    constructor(
        public readonly w0: number, // uint32
        public readonly w1: number, // uint32
    ) {
        assert(this.w0 >= 0 && this.w0 <= 0xFFFFFFFF);
        assert(this.w1 >= 0 && this.w1 <= 0xFFFFFFFF);
    }

    public c0(pos: number, width: number): number {
        return bitfield(this.w0, pos, width)
    }
    public c1(pos: number, width: number): number {
        return bitfield(this.w1, pos, width)
    }


    public static readFromView(view: DataView, offset: number): GFX {
        return new GFX(
            view.getUint32(offset),
            view.getUint32(offset + 4),
        );
    }

    public command(): Command {
        const cmd = (this.w0 >> 24) & 0xFF;

        // This "signs" the byte. I hate JS.
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Right_shift
        return cmd << 24 >> 24;
    }
}
export const gfxStructSize = 8;

export interface Mesh {
    inputLayout: GfxInputLayout;
    vertexBuffer: GfxBuffer;
    indexBuffer: GfxBuffer;
    indexCount: number;
}

export class MeshBuilder implements Mesh {
    public vertices: Vertex[] = [];
    public indices: number[] = [];

    // Available after build() has been called.
    public inputLayout: GfxInputLayout;
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public indexCount: number;

    public pushFace(verts: Vertex[]): void {
        const last = this.vertices.length;
        this.vertices.push(...verts);
        this.indices.push(...verts.map((_, i) => last+i));
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }

    public build(device: GfxDevice, cache: GfxRenderCache): void {
        const vertexArray = new Float32Array(this.vertices.length * 5);
        this.vertices.forEach((v, i) => {
            vertexArray.set(
                [v.x, v.y, v.z, v.s, v.t],
                i * 5,
            );
        });
        this.vertices = [];

        const indexArray = new Uint16Array(this.indices.length);
        indexArray.set(this.indices);
        this.indexCount = this.indices.length;
        this.indices = [];

        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexArray.buffer);
        device.setResourceName(this.vertexBuffer, "mesh vertex buffer");
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indexArray.buffer);
        device.setResourceName(this.indexBuffer, "mesh index buffer");

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                {
                    location: Program.a_Position,
                    format: GfxFormat.F32_RGB,
                    bufferByteOffset: 0,
                    bufferIndex: 0,
                },
                {
                    location: Program.a_TexCoord,
                    format: GfxFormat.F32_RG,
                    bufferByteOffset: 3 * 4,
                    bufferIndex: 0,
                },
            ],

            vertexBufferDescriptors: [
                {
                    byteStride: 5 * 4,
                    frequency: GfxVertexBufferFrequency.PerVertex,
                },
            ],

            indexBufferFormat: GfxFormat.U16_R,
        });
    }
}


function segAddr(addr: number): number {
    const seg = (addr & 0xFF000000) >> 24;
    assert(seg == Segment.BGVTX);
    return addr & 0x00FFFFFF;
}

export class DisplayListMeshBuilder extends MeshBuilder {
    private vtxSegments: Vertex[][] = [];
    private vtxCache: Vertex[][] = [];

    public offset: Vertex = {
        x: 0, y: 0, z: 0, s: 0, t: 0,
    }; // DEBUG

    constructor() {
        super();

        this.vtxCache[Segment.BGVTX] = [];
        this.vtxCache[Segment.BGVTX].fill({
            x:      0,
            y:      0,
            z:      0,
            s:      0,
            t:      0,
        }, 0, 16);
    }

    public setSegmentVertices(segment: Segment, vtx: Vertex[]): void {
        switch(segment) {
            case Segment.BGVTX:
                this.vtxSegments[Segment.BGVTX] = vtx;
                break;
            default:
                throw new Error(`Unexpected segment: ` + hexzero0x(segment));
        }
    }

    public processGFX(gfx: GFX): void {
        switch(gfx.command()) {
            case Command.G_VTX:
                this.gSPVertex(gfx);
                break;
            case Command.G_TRI4:
                this.gSPTri4(gfx);
                break;
        }
    }

    private gSPVertex(gfx: GFX): void {
        const srcIndex = segAddr(gfx.w1) / vertexStructSize;
        const n = gfx.c0(0, 16) / vertexStructSize;
        const dstIndex = gfx.c0(16, 4);

        if (dstIndex+n > this.vtxSegments[Segment.BGVTX].length) {
            throw new Error("vtxCache overflow");
        }

        for (let i = 0; i < n; i++) {
            this.vtxCache[Segment.BGVTX][dstIndex + i] = this.vtxSegments[Segment.BGVTX][srcIndex + i];
        }
    }

    private gSPTri(a:number, b:number, c:number): void {
        assert(a < 16 && b < 16 && c < 16, "vertex index out of vtxCache bounds");

        const verts: Vertex[] = [
            structuredClone(this.vtxCache[Segment.BGVTX][a]),
            structuredClone(this.vtxCache[Segment.BGVTX][b]),
            structuredClone(this.vtxCache[Segment.BGVTX][c]),
        ];

        verts.forEach(v => {
            v.x += this.offset.x;
            v.y += this.offset.y;
            v.z += this.offset.z;

            // That's a guess.
            v.s = (v.s + 0x7FF) / 0xFFF;
            v.t = (v.t + 0x7FF) / 0xFFF;
        });

        this.pushFace(verts);
    }

    private gSPTri4(gfx: GFX): void {
        const tri = (a:number, b:number, c:number): void => {
            if (a == 0 && b == 0 && c == 0) {
                return;
            }

            this.gSPTri(a, b, c);
        };

        tri(
            gfx.c1(0, 4),
            gfx.c1(4, 4),
            gfx.c0(0, 4),
        )
        tri(
            gfx.c1(8, 4),
            gfx.c1(12, 4),
            gfx.c0(4, 4),
        )
        tri(
            gfx.c1(16, 4),
            gfx.c1(20, 4),
            gfx.c0(8, 4),
        )
        tri(
            gfx.c1(24, 4),
            gfx.c1(28, 4),
            gfx.c0(12, 4),
        )
    }
}
