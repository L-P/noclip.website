import { DeviceProgram } from "../Program";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";

export class Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_TexCoord = 1;
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

        void main() {
            gl_FragColor = vec4(.5, v_TexCoord.xy, 1.0);
        }
    `;

    public override vert = `
        ${Program.common}

        layout(location = ${Program.a_Position}) in vec3 a_Position;
        layout(location = ${Program.a_TexCoord}) in vec2 a_TexCoord;

        out vec2 v_TexCoord;

        void main() {
            vec3 t_PositionWorld = (UnpackMatrix(u_WorldFromLocal) * vec4(a_Position.xyz, 1.0f)).xyz;

            gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(t_PositionWorld, 1.0f);

            v_TexCoord = a_TexCoord.xy;
        }
    `;
}
