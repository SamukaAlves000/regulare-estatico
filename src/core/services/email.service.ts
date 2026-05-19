import { Injectable } from '@angular/core';

export interface InviteEmailData {
  to: string;
  userName: string;
  companyName: string;
  inviteLink: string;
}

@Injectable({
  providedIn: 'root'
})
export class EmailService {
  async sendInviteEmail(data: InviteEmailData): Promise<boolean> {
    try {
      const response = await fetch('/.netlify/functions/send-invite-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send email');
      }

      const result = await response.json();
      return result.success;
    } catch (error) {
      console.error('EmailService Error:', error);
      throw error;
    }
  }
}
