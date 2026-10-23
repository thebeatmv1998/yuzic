/**
 * Web shim for `@react-native-community/slider`.
 *
 * The real component is native. This renders a native `<input type="range">`,
 * which gives the same affordance (drag to change a bounded value) and is
 * keyboard- and screen-reader-accessible for free.
 *
 * The call sites use it for volume, playback speed, crossfade, loudness and the
 * equalizer bands. A couple of them draw it vertically; the browser input does
 * not rotate, so those render flat — the value still changes.
 */
import React from 'react';
import { View } from 'react-native';

type SliderProps = {
  value?: number;
  minimumValue?: number;
  maximumValue?: number;
  step?: number;
  disabled?: boolean;
  onValueChange?: (value: number) => void;
  onSlidingStart?: () => void;
  onSlidingComplete?: (value: number) => void;
  minimumTrackTintColor?: string;
  maximumTrackTintColor?: string;
  thumbTintColor?: string;
  style?: unknown;
  testID?: string;
  accessibilityLabel?: string;
};

export default function Slider({
  value = 0,
  minimumValue = 0,
  maximumValue = 1,
  step = 0,
  disabled = false,
  onValueChange,
  onSlidingStart,
  onSlidingComplete,
  thumbTintColor,
  style,
  testID,
  accessibilityLabel,
}: SliderProps) {
  const read = (event: { target: { value: string } }) => Number(event.target.value);
  return (
    <View style={style as never}>
      {React.createElement('input', {
        type: 'range',
        min: minimumValue,
        max: maximumValue,
        step: step > 0 ? step : 'any',
        value,
        disabled,
        'data-testid': testID,
        'aria-label': accessibilityLabel,
        onPointerDown: onSlidingStart,
        onChange: (event: { target: { value: string } }) => onValueChange?.(read(event)),
        onMouseUp: (event: { target: { value: string } }) => onSlidingComplete?.(read(event)),
        onTouchEnd: (event: { target: { value: string } }) => onSlidingComplete?.(read(event)),
        style: { width: '100%', accentColor: thumbTintColor },
      })}
    </View>
  );
}
