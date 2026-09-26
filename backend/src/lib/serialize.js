/**
 * Representation publique d'un utilisateur.
 * Le numero de telephone est volontairement expose : il n'y a pas de masquage,
 * l'appel direct acheteur <-> vendeur est une fonctionnalite cle du MVP.
 */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    name_audio_key: user.name_audio_key,
    avatar_key: user.avatar_key,
    language: user.language,
    district_id: user.district_id,
    district_name: user.district_name || null,
    city: user.city,
    phone_verified: user.phone_verified,
    is_admin: Boolean(user.is_admin),
    notify_sms: user.notify_sms,
    notify_push: user.notify_push,
    created_at: user.created_at,
  };
}

export default { publicUser };
