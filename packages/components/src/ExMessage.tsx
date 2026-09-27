import { Toaster } from '@exre/exui'
import { useEffect, useLayoutEffect, useState } from 'react'
import {
  mountMessageHost,
  resolveConfig,
  showLoading,
  showMessage,
  unmountMessageHost,
  updateMessageHost,
} from './exMessageController'
import type { ExMessageProps, LoadingHandle, MessageOptions } from './exMessageController'
import type { ReactNode } from 'react'

type ExMessageComponent = ((props: ExMessageProps) => React.JSX.Element) & {
  info(content: ReactNode, options?: MessageOptions): string | number
  warn(content: ReactNode, options?: MessageOptions): string | number
  error(content: ReactNode, options?: MessageOptions): string | number
  loading(content: ReactNode, options?: MessageOptions): LoadingHandle
}

const placementValues = new Set([
  'top-left', 'top-center', 'top-right',
  'bottom-left', 'bottom-center', 'bottom-right',
])

function MessageHost({ duration, placement = 'top-right', maxCount }: ExMessageProps) {
  const [token] = useState(() => Symbol('ExMessage host'))
  const config = resolveConfig({ duration, maxCount })
  if (!placementValues.has(placement)) throw new RangeError('ExMessage placement is invalid.')

  useEffect(() => {
    mountMessageHost(token, config)
    return () => unmountMessageHost(token)
    // Only the host lifecycle is tied to the component instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useLayoutEffect(() => { updateMessageHost(token, config) }, [token, config.duration, config.maxCount])

  return <Toaster position={placement} visibleToasts={config.maxCount} />
}

export const ExMessage: ExMessageComponent = Object.assign(MessageHost, {
  info: (content: ReactNode, options?: MessageOptions) => showMessage('info', content, options),
  warn: (content: ReactNode, options?: MessageOptions) => showMessage('warning', content, options),
  error: (content: ReactNode, options?: MessageOptions) => showMessage('error', content, options),
  loading: showLoading,
})

export type { ExMessagePlacement, ExMessageProps, LoadingHandle, MessageOptions } from './exMessageController'
