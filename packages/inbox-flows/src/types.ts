declare const brand: unique symbol

type Brand<T, B extends string> = T & { readonly [brand]: B }

export type FlowId = Brand<number, 'FlowId'>

export type FlowVersionId = Brand<number, 'FlowVersionId'>

export type FlowBindingId = Brand<number, 'FlowBindingId'>

export type FlowRunId = Brand<number, 'FlowRunId'>

export type FlowEffectId = Brand<number, 'FlowEffectId'>
