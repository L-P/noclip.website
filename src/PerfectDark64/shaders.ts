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
            Mat2x4 u_TexMatrix[2];
            float u_hasValidTexture;
            float u_minAlpha;
        };

        uniform sampler2D u_Texture;

        varying vec4 v_TexCoord;
        varying vec4 v_VertexColors;
    `;

    public override frag = `
        ${Program.common}

        void main() {
            vec4 col = vec4(1.0, 1.0, 1.0, 1.0);
            #ifdef ENABLE_TEXTURES
                if (u_hasValidTexture > 0.0) {
                    col = texture(SAMPLER_2D(u_Texture), v_TexCoord.xy);
                }
            #endif

            #ifdef ENABLE_VERTEX_COLORS
                col *= v_VertexColors.rgba;
            #endif

            gl_FragColor = vec4(col.rgb, max(col.a, u_minAlpha));
        }
    `;

    public override vert = `
        ${Program.common}

        layout(location = ${Program.a_Position}) in vec3 a_Position;
        layout(location = ${Program.a_TexCoord}) in vec2 a_TexCoord;
        layout(location = ${Program.a_VertexColors}) in vec4 a_VertexColors;

        void main() {
            vec3 t_PositionWorld = (UnpackMatrix(u_WorldFromLocal) * vec4(a_Position.xyz, 1.0f)).xyz;

            gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(t_PositionWorld, 1.0f);

            v_TexCoord.xy = UnpackMatrix(u_TexMatrix[0]) * vec4(a_TexCoord, 1.0, 1.0);
            v_TexCoord.zw = UnpackMatrix(u_TexMatrix[1]) * vec4(a_TexCoord, 1.0, 1.0);
            v_VertexColors = a_VertexColors;
        }
    `;
}
