import { create } from 'zustand';
import type { Message } from '../types/message.js';
// Widget-local presentation state. Chrome remains the data authority.
export const useUIStore=create<{
  searchQuery:string; toast:string;
  setSearchQuery:(value:string)=>void;
  showToast:(value:{message:string})=>void;
  setReplyingTo:(message:Message)=>void;
  openLightbox:(url:string)=>void;
  openVideoLightbox:(url:string)=>void;
}>(set=>({
  searchQuery:'',toast:'',
  setSearchQuery:searchQuery=>set({searchQuery}),
  showToast:({message})=>set({toast:message}),
  setReplyingTo:()=>set({toast:'Quoted replies are available in the Inflow Chrome app.'}),
  openLightbox:()=>set({toast:'Open the Inflow Chrome app to view this attachment.'}),
  openVideoLightbox:()=>set({toast:'Open the Inflow Chrome app to play this attachment.'}),
}));
