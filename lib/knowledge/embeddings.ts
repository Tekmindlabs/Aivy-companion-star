import { pipeline, Pipeline, FeatureExtractionPipeline } from '@xenova/transformers';
import { searchSimilarContent } from '../milvus/vectors';

// Utility function for tensor conversion
function convertToTypedArray(data: any[]): Float32Array {
  try {
    // Convert BigInt64Array to regular numbers first
    if (data instanceof BigInt64Array) {
      return new Float32Array(Array.from(data).map(Number));
    }
    // If already a typed array, convert to Float32Array
    if (ArrayBuffer.isView(data)) {
      return new Float32Array(Array.from(data));
    }
    // If regular array, convert directly
    return new Float32Array(data);
  } catch (error) {
    console.error('Error converting tensor data:', error);
    throw new Error('Failed to convert tensor data to proper format');
  }
}

// Define the interface before the class
export interface EmbeddingOutput {
  data: Float32Array | number[];
}

class EmbeddingModel {
  private static instance: FeatureExtractionPipeline | null = null;
  private static isLoading: boolean = false;
  private static loadingPromise: Promise<FeatureExtractionPipeline> | null = null;

  static async getInstance(): Promise<FeatureExtractionPipeline> {
    if (this.instance) {
      return this.instance;
    }

    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.isLoading = true;
    this.loadingPromise = (async () => {
      try {
        console.log('Loading GTE-Base model...');
        
        const options = {
          executionProviders: ['cpu'],
          graphOptimizationLevel: 'all',
          tensorFormat: {
            inputFormat: 'float32',
            outputFormat: 'float32'
          }
        };

        const model = await pipeline('feature-extraction', 'Xenova/gte-base', {
          revision: 'main',
          quantized: false,
          ...options
        }) as FeatureExtractionPipeline;

        if (!model) {
          throw new Error('Failed to initialize embedding model');
        }

        this.instance = model;
        return this.instance;
      } catch (error) {
        console.error('Error loading model:', error);
        throw error;
      } finally {
        this.isLoading = false;
        this.loadingPromise = null;
      }
    })();

    return this.loadingPromise;
  }

  static async processTensorInput(input: any) {
    try {
      const tensor = {
        input_ids: convertToTypedArray(Array.from(input.input_ids.cpuData)),
        attention_mask: convertToTypedArray(Array.from(input.attention_mask.cpuData)),
        token_type_ids: convertToTypedArray(Array.from(input.token_type_ids.cpuData))
      };
      return tensor;
    } catch (error) {
      console.error('Error processing tensor input:', error);
      throw new Error('Failed to process tensor input');
    }
  }
}

export async function getEmbedding(text: string): Promise<number[]> {
  if (!text) {
    throw new Error("text may not be null or undefined");
  }
  
  try {
    const model = await EmbeddingModel.getInstance();
    if (!model) {
      throw new Error('Model not initialized');
    }

    const output = await model(text, {
      pooling: 'mean',
      normalize: true,
      convertToTensor: true // Add this option
    }) as EmbeddingOutput;

    // Ensure output.data is converted to regular array
    if (output.data instanceof Float32Array) {
      return Array.from(output.data);
    }
    return Array.from(convertToTypedArray(output.data));
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }
}

interface SearchParams {
  userId: string;
  embedding: number[];
  limit?: number;
  contentTypes?: string[];
}

export async function semanticSearch(
  query: string,
  userId: string,
  limit: number = 5
): Promise<any[]> {
  try {
    const queryEmbedding = await getEmbedding(query);
    
    return await searchSimilarContent({
      userId,
      embedding: queryEmbedding,
      limit,
      contentTypes: ['document', 'note', 'url']
    });
  } catch (error) {
    console.error('Error in semantic search:', error);
    throw error;
  }
}

export { EmbeddingModel };