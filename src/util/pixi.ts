import { Buffer } from "buffer";
import { BaseTexture, ImageResource, Renderer, Texture } from "pixi.js";

export const DESTROY_ALL = {
    children: true,
    texture: true,
    baseTexture: true,
};

export const DESTROY_MIN = {
    children: false,
    texture: false,
    baseTexture: false,
};

const ALLOWED_IMAGETYPES = ['jpeg', 'png', 'x-jg', 'bmp', 'x-icon', 'ief', 'pjpeg', 'x-portable-bitmap', 'x-rgb', 'tiff', 'x-tiff']

function validateImageMimeType(type: string): void {
    if (!type.startsWith('image/')) throw new Error('Invalid type: it should be an image');
    if (ALLOWED_IMAGETYPES.indexOf(type.substring('image/'.length)) < 0) throw new Error('Unsupported image type');
}

export async function loadTexture(data: ArrayBuffer, dataType: string): Promise<Texture> {
    const image = await loadTextureHTML(data, dataType);
    return new Texture(new BaseTexture(new ImageResource(image)));
}

export function loadTextureHTML(data: ArrayBuffer, dataType: string): Promise<HTMLImageElement> {
    validateImageMimeType(dataType);
    let b64 = 'data:' + dataType + ';base64,' + Buffer.from(data).toString('base64');

    return new Promise<HTMLImageElement>((resolve, reject) => {
        let image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = b64;
    });
}

export enum CUSTOM_BLEND_MODES {
    MULTIPLY_COLOR_ONLY = 30,
    ADD_WHERE_ALPHA_1,
}

export function addCustomBlendModes(renderer: Renderer) {
    let gl = renderer.gl;
    let array = (renderer.state as any).blendModes;
    // [src_color_factor, dst_color_factor, src_alpha_factor, dst_alpha_factor]
    array[CUSTOM_BLEND_MODES.MULTIPLY_COLOR_ONLY] = [gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE];// color = src*dst alpha=dst (dst=main canvas)
    array[CUSTOM_BLEND_MODES.ADD_WHERE_ALPHA_1] = [gl.DST_ALPHA, gl.ONE, gl.ZERO, gl.ONE];
}
