import { Vector3 } from 'three'

const UP = new Vector3(0, 1, 0)
const _flat = new Vector3()
const _right = new Vector3()

/**
 * Pan along the camera's flattened view.
 * right = forward × up. Camera looking down −z (0,0,−1) strafes to +x.
 * `out` is the caller's vector. The scratch vectors stay in this function.
 */
export function panVector(
  fwdX: number,
  fwdY: number,
  fwdZ: number,
  forward: number,
  strafe: number,
  out: Vector3,
): Vector3 {
  void fwdY
  _flat.set(fwdX, 0, fwdZ)
  if (_flat.lengthSq() < 1e-8) return out.set(0, 0, 0)
  _flat.normalize()
  _right.crossVectors(_flat, UP)
  return out.set(
    _flat.x * forward + _right.x * strafe,
    0,
    _flat.z * forward + _right.z * strafe,
  )
}
