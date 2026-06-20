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
