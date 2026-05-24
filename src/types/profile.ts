export interface Profile {
  urn: string;
  publicId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  occupation: string;
  location: string;
  pictureUrl: string;
  company?: string;
  title?: string;
  companyLogoUrl?: string;
}
