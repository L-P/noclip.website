import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { assert, hexzero0x } from "../util";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";

import { Program } from "./shaders";

// Vertex as used by the RSP.
export interface Vertex {
    x:      number; // uint16
    y:      number; // uint16
    z:      number; // uint16
    flags:  number; // uint8
    colour: number; // uint8
    s:      number; // uint16
    t:      number; // uint16
};
export const vertexStructSize = 12;
const vertexElementsCount = 7;

// Vertex as used by our shader.
interface ComputedVertex extends Vertex {
    cr: number; // uint8, color/normal
    cg: number; // uint8, color/normal
    cb: number; // uint8, color/normal
    ca: number; // uint8, color/normal
}
const computedVertexElementsCount = 5 + 4; // no flags/colour in vertex buffer

export interface Colour {
    r: number; // uint8
    g: number; // uint8
    b: number; // uint8
    a: number; // uint8
};
export const colourStructSize = 4;

export function loadVertexFromView(view: DataView, offset: number): Vertex {
    return {
        x:      view.getInt16(offset),
        y:      view.getInt16(offset + 2),
        z:      view.getInt16(offset + 4),
        flags:  view.getUint8(offset + 6),
        colour: view.getUint8(offset + 7),
        s:      view.getInt16(offset + 8),
        t:      view.getInt16(offset + 10),
    };
}

export enum Command {
    G_SPNOOP            = 0x00,
    G_VTX               = 0x04,
    G_COL               = 0x07,// like  G_VTX but for vertex colours.
	// Used in stored assets and unpacks to multiple commands.
    G_NOOP              = 0xC0,
    G_TRI1              = 0xBF,
    G_ENDDL             = 0xB8,
    G_SETGEOMETRYMODE   = 0xB7,
    G_CLEARGEOMETRYMODE = 0xB6,
    G_TRI4              = 0xB1,

	G_RDPFULLSYNC     = 0xE9,
	G_RDPTILESYNC     = 0xE8,
	G_RDPPIPESYNC     = 0xE7,
	G_RDPLOADSYNC     = 0xE6,
}

export enum Segment {
    Physical  = 0,
    Title     = 2,
    ModelMTX  = 3,
    ModelVTX  = 4,
    ModelCol1 = 5,
    ModelCol2 = 6,
    BGCol     = 13,
    BGVtx     = 14, // 0x0E
    BGDL      = 15,
}

enum GeometryMode {
    G_ZBUFFER            = 0x00000001,
    G_SHADE              = 0x00000004,
    G_TEXTURE_ENABLE     = 0x00000002,
    G_SHADING_SMOOTH     = 0x00000200,
    G_CULL_FRONT         = 0x00001000,
    G_CULL_BACK          = 0x00002000,
    G_CULL_BOTH          = 0x00003000,
    G_FOG                = 0x00010000,
    G_LIGHTING           = 0x00020000,
    G_TEXTURE_GEN        = 0x00040000,
    G_TEXTURE_GEN_LINEAR = 0x00080000,
    G_LOD                = 0x00100000,
    G_CLIPPING           = 0x00000000,
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
        return (this.w0 >> 24) & 0xFF;
    }
}
export const gfxStructSize = 8;

export class Mesh {
    public inputLayout: GfxInputLayout;
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public indexCount: number = 0;
    public isSkybox: boolean = false;

    // Returns true if the mesh has been successfuly built an can be rendered.
    public isValid(): boolean {
        return this.indexCount > 0;
    }

    public destroy(device: GfxDevice): void {
        if (!this.isValid()) {
            return;
        }

        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

export class MeshBuilder {
    public vertices: ComputedVertex[] = [];
    public indices: number[] = [];

    public pushFace(verts: ComputedVertex[]): void {
        const last = this.vertices.length;
        this.vertices.push(...verts);
        this.indices.push(...verts.map((_, i) => last+i));
    }

    public buildMesh(device: GfxDevice, cache: GfxRenderCache): Mesh {
        const mesh = new Mesh();

        if (this.indices.length == 0) {
            console.warn("attempted to build an empty mesh");
            return mesh;
        }

        const vertexArray = new Float32Array(this.vertices.length * computedVertexElementsCount);
        this.vertices.forEach((v, i) => {
            vertexArray.set(
                [
                    v.x, v.y, v.z,
                    v.s, v.t,
                    v.cr, v.cg, v.cb, v.ca,
                ],
                i * computedVertexElementsCount,
            );
        });
        this.vertices = [];

        const indexArray = new Uint16Array(this.indices.length);
        indexArray.set(this.indices);
        mesh.indexCount = this.indices.length;
        this.indices = [];

        mesh.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexArray.buffer);
        device.setResourceName(mesh.vertexBuffer, "mesh vertex buffer");
        mesh.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indexArray.buffer);
        device.setResourceName(mesh.indexBuffer, "mesh index buffer");

        mesh.inputLayout = cache.createInputLayout({
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
                    bufferByteOffset: 3*4,
                    bufferIndex: 0,
                },
                {
                    location: Program.a_VertexColors,
                    format: GfxFormat.F32_RGBA,
                    bufferByteOffset: 5*4,
                    bufferIndex: 0,
                },
            ],

            vertexBufferDescriptors: [{
                byteStride: computedVertexElementsCount * 4,
                frequency: GfxVertexBufferFrequency.PerVertex,
            }],

            indexBufferFormat: GfxFormat.U16_R,
        });

        return mesh;
    }
}

interface SegmentAddress {
    segment: Segment;
    address: number;
}

function segAddr(addr: number): SegmentAddress {
    return {
        segment: (addr & 0xFF000000) >> 24,
        address: addr & 0x00FFFFFF,
    };
}

export class Interpreter {
    private vtxSegments: Vertex[][] = [];
    private colSegments: Colour[][] = [];
    private vtxCache: Vertex[] = Array<Vertex>(16);
    private colCache: Colour[] = [];
    private geometryMode: GeometryMode = 0; // bitflags

    private cur: MeshBuilder = new MeshBuilder();
    private meshes: MeshBuilder[] = [];

    constructor() {
        this.vtxSegments[Segment.BGVtx] = [];
        this.colSegments[Segment.BGCol] = [];
    }

    private flush() {
        this.meshes.push(this.cur);
        this.cur = new MeshBuilder();
    }

    public build(device: GfxDevice, cache: GfxRenderCache): Mesh[] {
        this.flush();

        return this.meshes.
            map(v => v.buildMesh(device, cache)).
            filter(v => v.isValid())
        ;
    }

    public setSegmentVertices(segment: Segment, vertices: Vertex[]): void {
        switch(segment) {
            case Segment.BGVtx:
                this.vtxSegments[segment] = vertices;
                break;
            default:
                throw new Error(`Unexpected segment: ` + hexzero0x(segment));
        }
    }

    public setSegmentColours(segment: Segment, colours: Colour[]): void {
        switch(segment) {
            case Segment.BGCol:
                this.colSegments[segment] = colours;
                break;
            default:
                throw new Error(`Unexpected segment: ` + hexzero0x(segment));
        }
    }

    public processGFX(gfx: GFX): void {
        switch(gfx.command()) {
            case Command.G_ENDDL:
                return;
            case Command.G_VTX:
                this.gSPVertex(gfx);
                break;
            case Command.G_TRI1:
                this.gSPTri(
                    gfx.c1(16, 8),
                    gfx.c1(8, 8),
                    gfx.c1(0, 8),
                );
                break;
            case Command.G_TRI4:
                this.gSPTri4(gfx);
                break;
            case Command.G_COL:
                this.gSPColour(gfx);
                break;
            case Command.G_SETGEOMETRYMODE:
                this.geometryMode |= gfx.w1;
                break;
            case Command.G_CLEARGEOMETRYMODE:
                this.geometryMode &= ~gfx.w1;
                break;

            case Command.G_NOOP:
            case Command.G_SPNOOP:
            case Command.G_RDPFULLSYNC:
            case Command.G_RDPTILESYNC:
            case Command.G_RDPPIPESYNC:
            case Command.G_RDPLOADSYNC:
                // NOOP
                break
            default:
                const cmd = gfx.command() << 24 >> 24;
                // DEBUG console.warn("unknown command:", cmd, hexzero0x(gfx.command()).slice(8));
        }
    }

    private gSPVertex(gfx: GFX): void {
        const src = segAddr(gfx.w1);
        const srcIndex = src.address / vertexStructSize;
        const n = gfx.c0(0, 16) / vertexStructSize;
        const dstIndex = gfx.c0(16, 4);

        if (dstIndex+n > this.vtxCache.length) {
            throw new Error("vtxCache overflow");
        }

        for (let i = 0; i < n; i++) {
            this.vtxCache[dstIndex + i] = this.vtxSegments[src.segment][srcIndex + i];
        }
    }

    // Got conflicting info between obviously wrong comments in the decomp and
    // the port implementation. I'll do what the port does and hope for the best.
    private gSPColour(gfx: GFX): void {
        const src = segAddr(gfx.w1);
        this.colCache = this.colSegments[src.segment].slice(src.address / 4);
    }

    private gSPTri(a:number, b:number, c:number): void {
        assert(a < 16 && b < 16 && c < 16, "vertex index out of vtxCache bounds");

        const verts: ComputedVertex[] = [
            { ...this.vtxCache[a], cr: 0, cg: 0, cb: 0, ca: 0, },
            { ...this.vtxCache[b], cr: 0, cg: 0, cb: 0, ca: 0, },
            { ...this.vtxCache[c], cr: 0, cg: 0, cb: 0, ca: 0, },
        ];

        verts.forEach(v => {
            // That's a guess.
            v.s = (v.s + 0x7FF) / 0xFFF;
            v.t = (v.t + 0x7FF) / 0xFFF;

            const col: Colour = this.colCache[v.colour >> 2];
            if (col !== undefined) {
                v.cr = col.r / 255.0;
                v.cg = col.g / 255.0;
                v.cb = col.b / 255.0;
                v.ca = col.a / 255.0;
            }
        });

        this.cur.pushFace(verts);
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
