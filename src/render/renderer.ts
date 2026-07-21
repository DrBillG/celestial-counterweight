import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

export class Renderer {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera: THREE.PerspectiveCamera
  composer: EffectComposer

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.setSize(innerWidth, innerHeight)
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 5000)
    // Tilted god view of the xy orbital plane, pulled in so the populated inner
    // system (mercury..saturn) fills the frame while neptune + the Harmony Ring
    // sit near the edges.
    this.camera.position.set(0, -190, 150)
    this.camera.lookAt(0, 0, 0)

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    // Lower threshold ~0 so even mid stars catch bloom; higher strength so the
    // brightest "hero" stars visibly burn with halos.
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1.1, 0.6, 0.0))

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(innerWidth, innerHeight)
      this.composer.setSize(innerWidth, innerHeight)
    })
  }

  render() {
    this.composer.render()
  }

  // Free GPU resources so the sky/scene can be torn down and rebuilt
  // (e.g. Task 16 quality changes) without leaking buffers or contexts.
  dispose() {
    for (const pass of this.composer.passes) {
      ;(pass as { dispose?: () => void }).dispose?.()
    }
    this.composer.renderTarget1.dispose()
    this.composer.renderTarget2.dispose()
    this.renderer.dispose()
  }
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}
