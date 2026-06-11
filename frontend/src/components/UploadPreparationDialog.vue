<template>
  <div class="upload-prep-backdrop" role="presentation" @click.self="$emit('cancel')">
    <section class="upload-prep-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-prep-title">
      <header class="upload-prep-header">
        <span class="upload-prep-badge">{{ t('prep.badge') }}</span>
        <h2 id="upload-prep-title">{{ t('prep.title') }}</h2>
        <p class="muted">{{ t('prep.note') }}</p>
      </header>

      <div class="upload-prep-stats">
        <span><strong>{{ fileCount }}</strong> {{ t('prep.filesSelected') }}</span>
        <span><strong>{{ imageCount }}</strong> {{ t('prep.optimizableImages') }}</span>
        <span><strong>{{ formatSize(totalSize) }}</strong> {{ t('prep.total') }}</span>
      </div>

      <div class="upload-mode-grid">
        <button
          class="upload-mode-card"
          :class="{ active: !imageProcessing.enabled }"
          type="button"
          @click="setOptimization(false)"
        >
          <strong>{{ t('prep.originalTitle') }}</strong>
          <span>{{ t('prep.originalDesc') }}</span>
        </button>
        <button
          class="upload-mode-card"
          :class="{ active: imageProcessing.enabled }"
          type="button"
          @click="setOptimization(true)"
        >
          <strong>{{ t('prep.compressTitle') }}</strong>
          <span>{{ t('prep.compressDesc') }}</span>
        </button>
      </div>

      <ImageProcessingPanel
        :model-value="imageProcessing"
        :active-format="activeFormat"
        :format-options="formatOptions"
        :summary="summary"
        @update:model-value="$emit('update:imageProcessing', $event)"
        @select-format="$emit('select-format', $event)"
      />

      <div class="upload-prep-files" v-if="previewFiles.length">
        <span v-for="(file, index) in previewFiles" :key="`${file.name}_${file.size}_${index}`" class="badge">
          {{ file.name }}
        </span>
        <span v-if="fileCount > previewFiles.length" class="badge">
          {{ t('prep.more', { n: fileCount - previewFiles.length }) }}
        </span>
      </div>

      <footer class="upload-prep-actions">
        <button class="btn btn-ghost" type="button" @click="$emit('cancel')">{{ t('prep.cancel') }}</button>
        <button class="btn btn-ghost" type="button" @click="$emit('upload-original')">{{ t('prep.uploadOriginal') }}</button>
        <button class="btn" type="button" @click="$emit('upload-optimized')">{{ t('prep.optimizeUpload') }}</button>
      </footer>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import ImageProcessingPanel from './ImageProcessingPanel.vue';
import { useI18n } from '../i18n';

const { t } = useI18n();

const props = defineProps({
  batch: {
    type: Object,
    required: true,
  },
  imageProcessing: {
    type: Object,
    required: true,
  },
  activeFormat: {
    type: Object,
    required: true,
  },
  formatOptions: {
    type: Array,
    default: () => [],
  },
  summary: {
    type: String,
    default: '',
  },
  formatSize: {
    type: Function,
    required: true,
  },
});

const emit = defineEmits([
  'update:imageProcessing',
  'select-format',
  'upload-original',
  'upload-optimized',
  'cancel',
]);

const files = computed(() => props.batch?.files || props.batch?.items?.map((item) => item.file) || []);
const fileCount = computed(() => files.value.length);
const imageCount = computed(() => Number(props.batch?.imageCount || 0));
const totalSize = computed(() => files.value.reduce((sum, file) => sum + Number(file?.size || 0), 0));
const previewFiles = computed(() => files.value.slice(0, 5));

function setOptimization(enabled) {
  emit('update:imageProcessing', {
    ...props.imageProcessing,
    enabled,
  });
}
</script>
