import { Schema, model, models, type InferSchemaType, type Model, Types } from 'mongoose';

/**
 * Persisted cache of official regional-availability facts (currently AWS's
 * Knowledge MCP `aws___get_regional_availability`, providers/aws/mcp.ts). A
 * pure (serviceId, region) -> boolean fact with no user-facing "cached"/
 * "refresh" affordance, so — unlike McpGuidanceCache — this uses a real Mongo
 * TTL index for automatic pruning instead of a manual staleness check.
 */
const serviceRegionAvailabilitySchema = new Schema(
  {
    provider: { type: String, enum: ['aws', 'mongodb', 'system'], required: true, default: 'aws' },
    serviceId: { type: String, required: true },
    region: { type: String, required: true },
    available: { type: Boolean, required: true },
    product: { type: String, required: true },
    checkedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false }
);

serviceRegionAvailabilitySchema.index({ provider: 1, serviceId: 1, region: 1 }, { unique: true });
serviceRegionAvailabilitySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type ServiceRegionAvailabilityDoc = InferSchemaType<typeof serviceRegionAvailabilitySchema> & {
  _id: Types.ObjectId;
};

export const ServiceRegionAvailability: Model<ServiceRegionAvailabilityDoc> =
  (models.ServiceRegionAvailability as Model<ServiceRegionAvailabilityDoc>) ??
  model<ServiceRegionAvailabilityDoc>('ServiceRegionAvailability', serviceRegionAvailabilitySchema);
