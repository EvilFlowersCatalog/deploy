# Creates (or reuses) the catalog user the extraction workers post as, grants it
# extraction.ingest_extraction, and prints a fresh API key for EXTRACTION_API_KEY in .env.
# Run it after the first administrator exists:
#
#   docker compose exec -T evilflowers python3 manage.py shell < scripts/extraction-api-key.py
from django.contrib.auth.models import Permission

from apps.core.auth import JWTFactory
from apps.core.models import ApiKey, User

# The catalog's own sign-in, the one the first administrator uses.
auth_source = User._meta.get_field("auth_source").related_model.objects.order_by("created_at").first()
user, _ = User.objects.get_or_create(
    username="extraction-service",
    defaults={"name": "Extraction", "surname": "Service", "auth_source": auth_source},
)
user.set_unusable_password()
user.save()
user.user_permissions.add(Permission.objects.get(content_type__app_label="extraction", codename="ingest_extraction"))
key = ApiKey.objects.create(user=user, name="extraction workers")
print(JWTFactory(str(user.pk)).api_key(str(key.pk)))
