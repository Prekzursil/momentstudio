"""wishlist items

Revision ID: 0028_wishlist_items
Revises: 0027_google_oauth_fields
Create Date: 2025-12-06
"""

from alembic import op
import sqlalchemy as sa
import uuid


# revision identifiers, used by Alembic.
revision = '0028_wishlist_items'
down_revision = '0027_google_oauth_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'wishlist_items',
        sa.Column('id', sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('user_id', sa.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('product_id', sa.UUID(as_uuid=True), sa.ForeignKey('products.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('user_id', 'product_id', name='uq_wishlist_user_product'),
    )


def downgrade() -> None:
    op.drop_table('wishlist_items')
