import { assert } from "../util";

export interface Vertex {
    x:      number; // uint16
    y:      number; // uint16
    z:      number; // uint16
    flags:  number; // uint8
    colour: number; // uint8
    s:      number; // uint16
    t:      number; // uint16
};

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

export const vertexStructSize = 12;

export enum Command {
	// Not a real command, used in stored assets and unpacks to multiple commands.
    G_PDTEXASSET = -64, // 0xC0
    G_ENDDL      = -72, // 0xB8
}

export class GFX {
    constructor(
        public readonly w0: number, // uint32
        public readonly w1: number, // uint32
    ) {
        assert(this.w0 >= 0 && this.w0 <= 0xFFFFFFFF);
        assert(this.w1 >= 0 && this.w1 <= 0xFFFFFFFF);
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
        // https://stackoverflow.com/a/67082621
        return cmd << 24 >> 24;
    }
}
export const gfxStructSize = 8;
