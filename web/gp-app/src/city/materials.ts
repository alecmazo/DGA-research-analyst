import { Color, MeshStandardMaterial } from 'three'

/** One clock for every window. The canvas writes these. The materials only read them. */
export const cityTime = { value: 0 }
export const cityNight = { value: 1 }
export const cityMotion = { value: 1 }

export function makeWindowMaterial(base: string, accent: string, intensity = 0.45): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    color: base,
    emissive: accent,
    emissiveIntensity: intensity,
    roughness: 0.32,
    metalness: 0.72,
  })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = cityTime
    shader.uniforms.uNight = cityNight
    shader.uniforms.uMotion = cityMotion
    shader.uniforms.uAccent = { value: new Color(accent) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCityPos;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvCityPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vCityPos;
         uniform float uTime;
         uniform float uNight;
         uniform float uMotion;
         uniform vec3 uAccent;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float col = abs(fract(vCityPos.x * 0.45) - 0.5);
         float row = abs(fract(vCityPos.y * 0.32) - 0.5);
         float win = smoothstep(0.18, 0.26, col) * smoothstep(0.12, 0.2, row);
         float dead = step(0.92, fract(vCityPos.y * 0.17 + vCityPos.x * 0.05));
         float scan = uMotion > 0.5 ? (0.55 + 0.45 * sin(vCityPos.y * 0.55 - uTime * 1.6)) : 0.8;
         float day = mix(0.22, 1.0, uNight);
         totalEmissiveRadiance += uAccent * win * (1.0 - dead) * scan * day * 2.1;`,
      )
  }
  mat.customProgramCacheKey = () => 'dga-city-windows'
  return mat
}

export function makeNeonMaterial(accent: string): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 2.4,
    roughness: 0.2,
    metalness: 0.4,
    toneMapped: false,
  })
  return mat
}
