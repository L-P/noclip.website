import { DeviceProgram } from "../Program";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";

export class Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_TexCoord = 1;
    public static a_VertexColors = 2;
    public static ub_SceneParams = 0;

    private static common = `
        ${GfxShaderLibrary.MatrixLibrary}

        layout(std140) uniform ub_SceneParams {
            Mat4x4 u_ClipFromWorld;
            Mat3x4 u_WorldFromLocal;
        };
    `;

    public override frag = `
        ${Program.common}

        in vec2 v_TexCoord;
        in vec4 v_VertexColors;

        void main() {
            gl_FragColor = vec4(v_VertexColors.rgba);
        }
    `;

    public override vert = `
        ${Program.common}

        layout(location = ${Program.a_Position}) in vec3 a_Position;
        layout(location = ${Program.a_TexCoord}) in vec2 a_TexCoord;
        layout(location = ${Program.a_VertexColors}) in vec4 a_VertexColors;

        out vec2 v_TexCoord;
        out vec4 v_VertexColors;

        void main() {
            vec3 t_PositionWorld = (UnpackMatrix(u_WorldFromLocal) * vec4(a_Position.xyz, 1.0f)).xyz;

            gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(t_PositionWorld, 1.0f);

            v_TexCoord = a_TexCoord.xy;
            v_VertexColors = a_VertexColors;
        }
    `;
}
