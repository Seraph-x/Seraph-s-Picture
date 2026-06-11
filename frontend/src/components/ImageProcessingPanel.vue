<template>
  <section class="image-processing card-lite" :class="{ enabled: modelValue.enabled }">
    <div class="image-processing-head">
      <div>
        <h3>{{ t('ipp.title') }}</h3>
        <p class="muted">{{ summary }}</p>
      </div>
      <label class="switch-control" :title="t('ipp.enableTip')">
        <input
          :checked="modelValue.enabled"
          type="checkbox"
          @change="updateField('enabled', $event.target.checked)"
        />
        <span class="switch-track">
          <span class="switch-thumb"></span>
        </span>
      </label>
    </div>

    <div v-if="modelValue.enabled" class="image-processing-grid">
      <label class="image-processing-field">
        <span>{{ t('ipp.format') }}</span>
        <div class="format-segments">
          <button
            v-for="format in formatOptions"
            :key="format.value"
            class="chip"
            :class="{ active: modelValue.format === format.value, disabled: !format.available }"
            :disabled="!format.available"
            type="button"
            :title="format.available ? format.label : t('ipp.cannotEncode')"
            @click="$emit('select-format', format.value)"
          >
            {{ format.label }}
          </button>
        </div>
      </label>

      <label v-if="activeFormat.supportsQuality" class="image-processing-field">
        <span>{{ t('ipp.quality') }} <strong>{{ modelValue.quality }}%</strong></span>
        <input
          :value="modelValue.quality"
          type="range"
          min="40"
          max="100"
          step="1"
          @input="updateNumber('quality', $event.target.value)"
        />
      </label>

      <label class="image-processing-field">
        <span>{{ t('ipp.maxEdge') }}</span>
        <input
          :value="modelValue.maxDimension"
          type="number"
          min="0"
          max="12000"
          step="100"
          :placeholder="t('ipp.maxEdgePh')"
          @input="updateNumber('maxDimension', $event.target.value)"
        />
      </label>

      <label class="inline-check">
        <input
          :checked="modelValue.keepOriginalWhenLarger"
          type="checkbox"
          @change="updateField('keepOriginalWhenLarger', $event.target.checked)"
        />
        <span>{{ t('ipp.keepOriginal') }}</span>
      </label>
    </div>
  </section>
</template>

<script setup>
import { useI18n } from '../i18n';

const { t } = useI18n();

const props = defineProps({
  modelValue: {
    type: Object,
    required: true,
  },
  formatOptions: {
    type: Array,
    default: () => [],
  },
  activeFormat: {
    type: Object,
    required: true,
  },
  summary: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['update:modelValue', 'select-format']);

function updateField(key, value) {
  emit('update:modelValue', {
    ...props.modelValue,
    [key]: value,
  });
}

function updateNumber(key, value) {
  const next = Number(value);
  updateField(key, Number.isFinite(next) ? next : 0);
}
</script>
