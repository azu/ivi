import { ComponentFlags } from "../vdom/flags";
import { Component } from "../vdom/component";
import { updateComponent } from "../vdom/implementation";
import { requestNextFrame } from "./frame";

export type Animation = () => boolean | undefined;

const _animations: Animation[] = [];
const _animatedComponents: Component<any>[] = [];

/**
 * Add component to the animated list.
 *
 * @param component
 */
export function startComponentAnimation(component: Component<any>): void {
    if (__IVI_BROWSER__) {
        requestNextFrame();
        component.flags |= ComponentFlags.Animated | ComponentFlags.InAnimationQueue;
        _animatedComponents.push(component);
    }
}

/**
 * Remove component from the animated list.
 *
 * @param component
 */
export function stopComponentAnimation(component: Component<any>): void {
    if (__IVI_BROWSER__) {
        component.flags |= ComponentFlags.Animated;
    }
}

/**
 * Prepare animated components by marking them dirty.
 */
export function prepareAnimatedComponents(): void {
    if (__IVI_BROWSER__) {
        for (let i = 0; i < _animatedComponents.length; i++) {
            _animatedComponents[i].flags |= ComponentFlags.DirtyState;
        }
    }
}

/**
 * Update animated components.
 */
export function updateAnimatedComponents(): void {
    if (__IVI_BROWSER__) {
        for (let i = 0; i < _animatedComponents.length; i++) {
            const component = _animatedComponents[i];
            if (component.flags & ComponentFlags.Animated) {
                updateComponent(component);
            } else {
                component.flags &= ~ComponentFlags.InAnimationQueue;
                if (i === _animatedComponents.length) {
                    _animatedComponents.pop();
                } else {
                    _animatedComponents[i--] = _animatedComponents.pop() !;
                }
            }
        }
    }
}

/**
 * Add animation.
 *
 * @param animation Animation task.
 */
export function addAnimation(animation: Animation): void {
    if (__IVI_BROWSER__) {
        _animations.push(animation);
    }
}

/**
 * Execute animations.
 */
export function executeAnimations(): void {
    if (__IVI_BROWSER__) {
        for (let i = 0; i < _animations.length; i++) {
            const animation = _animations[i];
            if (animation()) {
                if (i === _animations.length) {
                    _animations.pop();
                } else {
                    _animations[i--] = _animations.pop() !;
                }
            }
        }
    }
}

export function shouldRequestNextFrameForAnimations(): boolean {
    if (__IVI_BROWSER__) {
        return (
            (_animatedComponents.length > 0) ||
            (_animations.length > 0)
        );
    }
    return false;
}