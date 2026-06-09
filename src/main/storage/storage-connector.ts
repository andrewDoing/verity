export interface ArtifactMetadata {
  uri: string;
  size: number;
  modifiedAt?: string;
  contentType: string;
}

export interface StorageConnector {
  readonly scheme: string;
  readArtifact(uri: string): Promise<{ uri: string; text: string; metadata: ArtifactMetadata }>;
  writeArtifact(uri: string, text: string): Promise<ArtifactMetadata>;
  getMetadata(uri: string): Promise<ArtifactMetadata>;
  listArtifacts(uri: string): Promise<ArtifactMetadata[]>;
}
