export interface CustomToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object';
  description: string;
  required?: boolean;
  enum?: string[];
  default?: any;
}

export interface CustomToolMethod {
  name: string;
  description: string;
  parameters: Record<string, CustomToolParameter>;
  code: string;
}

export interface SharedVolumeAccess {
  folder: string;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
}

export interface DockerContainerCliCommand {
  toolName: string;
  command: string;
  description: string;
}

export interface DockerContainerToolsAccess {
  containerName: string;
  commands: DockerContainerCliCommand[];
}

export interface CustomToolDefinition {
  name: string;
  description?: string;
  methods: CustomToolMethod[];
  port?: number;
  sharedVolumeAccess?: SharedVolumeAccess[];
  dockerContainerTools?: DockerContainerToolsAccess;
}

export interface ValidateResponse {
  valid: boolean;
  errors: string[];
  message?: string;
}

export interface DeployResponse {
  success: boolean;
  containerId: string;
  containerName: string;
  message: string;
  error?: string;
}
