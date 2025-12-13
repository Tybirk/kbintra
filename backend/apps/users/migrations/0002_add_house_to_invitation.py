# Generated manually

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("houses", "0002_add_house_profile_picture"),
        ("users", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="invitation",
            name="house",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="invitations",
                to="houses.house",
                help_text="The house the invited user will belong to",
                # Since there are no existing invitations, we can use 1 as default
                # for migration purposes only
                default=1,
            ),
            preserve_default=False,
        ),
    ]
